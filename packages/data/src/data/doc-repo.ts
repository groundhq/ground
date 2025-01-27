import {z, ZodType} from 'zod';
import {astream, AsyncStream} from '../async-stream.js';
import {Context} from '../context.js';
import {Crdt, CrdtCodec, CrdtDiff} from '../crdt/crdt.js';
import {createIndex, Index, IndexKey} from '../kv/data-index.js';
import {
    Condition,
    queryStartsWith,
    Transaction,
    Uint8Transaction,
    withKeyCodec,
    withPrefix,
    withValueCodec,
} from '../kv/kv-store.js';
import {getNow, Timestamp, zTimestamp} from '../timestamp.js';
import {pipe, whenAll} from '../utils.js';
import {Uuid, UuidCodec, zUuid} from '../uuid.js';
import {UpdateChecker} from './update-checker.js';

export interface Doc<TId extends Uuid = Uuid> {
    id: TId;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export function zDoc<TId extends Uuid>() {
    return z.object({
        id: zUuid<TId>(),
        createdAt: zTimestamp(),
        updatedAt: zTimestamp(),
    });
}

export type IndexSpec<T> =
    | {
          readonly unique?: boolean | undefined;
          readonly key: (x: T) => IndexKey;
          readonly include?: (x: T) => boolean;
      }
    | ((x: T) => IndexKey);

export type IndexMap<T> = Record<string, IndexSpec<T>>;

export type OnDocChange<T extends Doc> = (
    ctx: Context,
    id: T['id'],
    diff: CrdtDiff<T>
) => Promise<void>;

export interface DocStoreOptions<T extends Doc> {
    tx: Uint8Transaction;
    indexes: IndexMap<T>;
    schema: ZodType<T>;
    onChange: OnDocChange<T>;
}

export type Recipe<T> = (doc: T) => T | void;

export interface SyncTarget<T> {
    apply(ctx: Context, id: Uuid, diff: CrdtDiff<T>): Promise<void>;
}

export class DocRepo<T extends Doc> implements SyncTarget<T> {
    private readonly indexes: Map<string, Index<T>>;
    private readonly primary: Transaction<Uuid, Crdt<T>>;
    private readonly primaryKeyRaw: Transaction<Uint8Array, Crdt<T>>;
    private readonly onChange: OnDocChange<T>;
    private readonly schema: ZodType<T>;

    constructor({tx, indexes, onChange, schema}: DocStoreOptions<T>) {
        this.indexes = new Map(
            Object.entries(indexes).map(([indexName, spec]) => {
                if (indexName.indexOf('/') !== -1) {
                    throw new Error(
                        'index name cannot contain /: ' + indexName
                    );
                }

                return [
                    indexName,
                    createIndex({
                        tx: withPrefix(`i/${indexName}/`)(tx),
                        idSelector: x => x.id,
                        keySelector:
                            typeof spec === 'function' ? spec : spec.key,
                        unique:
                            typeof spec === 'function'
                                ? false
                                : (spec.unique ?? false),
                        indexName,
                    }),
                ];
            })
        );
        this.primaryKeyRaw = pipe(
            tx,
            withPrefix('d/'),
            withValueCodec(new CrdtCodec())
        );
        this.primary = withKeyCodec(new UuidCodec())(this.primaryKeyRaw);
        this.onChange = onChange;
        this.schema = schema;
    }

    async getById(ctx: Context, id: Uuid): Promise<T | undefined> {
        const doc = await this.primary.get(ctx, id);
        return doc?.snapshot();
    }

    get(ctx: Context, indexName: string, key: IndexKey): AsyncStream<T> {
        const index = this._index(indexName);
        return this._mapToDocs(index.get(ctx, key));
    }

    async getUnique(
        ctx: Context,
        indexName: string,
        key: IndexKey
    ): Promise<T | undefined> {
        const index = this._index(indexName);
        const ids = await astream(index.get(ctx, key)).take(2).toArray(ctx);
        if (ids.length > 1) {
            throw new Error(
                `index ${indexName} contains multiple docs for the key: ${key}`
            );
        } else if (ids.length === 1) {
            return await this.getById(ctx, ids[0]);
        } else {
            return undefined;
        }
    }

    getAll(ctx: Context, prefix?: Uint8Array): AsyncStream<T> {
        return astream(
            queryStartsWith(ctx, this.primaryKeyRaw, prefix ?? new Uint8Array())
        ).map((_mapCtx, x) => x.value.snapshot());
    }

    query(
        ctx: Context,
        indexName: string,
        condition: Condition<IndexKey>
    ): AsyncStream<T> {
        const index = this._index(indexName);

        return this._mapToDocs(index.query(ctx, condition));
    }

    async update(ctx: Context, id: Uuid, recipe: Recipe<T>): Promise<T> {
        const doc = await this.primary.get(ctx, id);
        if (!doc) {
            throw new Error('doc not found: ' + id);
        }

        const prev = doc.snapshot();
        const diff = doc.update(draft => {
            const result = recipe(draft) ?? draft;

            result.updatedAt = getNow();

            return result;
        });
        if (!diff) {
            // no change were made to the document
            return prev;
        }
        const next = doc.snapshot();
        this.ensureValid(next);

        await whenAll([
            this.primary.put(ctx, id, doc),
            this._sync(ctx, id, prev, next, diff),
        ]);

        return next;
    }

    // todo: add tests
    async apply(
        ctx: Context,
        id: Uuid,
        diff: CrdtDiff<T>,
        updateChecker?: UpdateChecker<T>
    ): Promise<void> {
        let doc: Crdt<T> | undefined = await this.primary.get(ctx, id);
        let prev: T | undefined;
        let next: T;
        if (doc) {
            prev = doc.snapshot();
            doc.apply(diff);
            next = doc.snapshot();
        } else {
            prev = undefined;
            doc = Crdt.load(diff);
            next = doc.snapshot();
        }

        if (next.id !== id) {
            throw new Error('invalid diff: diff updates id ' + id);
        }

        if (prev && updateChecker) {
            updateChecker(prev, next);
        }

        this.ensureValid(next);
    }

    async create(ctx: Context, doc: T): Promise<T> {
        const existing = await this.primary.get(ctx, doc.id);
        if (existing) {
            throw new Error(`doc ${doc.id} already exists`);
        }

        const now = getNow();
        const crdt = Crdt.from({...doc, createdAt: now, updatedAt: now});
        await whenAll([
            this.primary.put(ctx, doc.id, crdt),
            this._sync(ctx, doc.id, undefined, doc, crdt.state()),
        ]);

        return crdt.snapshot();
    }

    private _index(indexName: string): Index<T> {
        const index = this.indexes.get(indexName);
        if (!index) {
            throw new Error('index not found: ' + indexName);
        }
        return index;
    }

    private async _sync(
        ctx: Context,
        id: Uuid,
        prev: T | undefined,
        next: T | undefined,
        diff: CrdtDiff<T>
    ): Promise<void> {
        await whenAll([
            ...[...this.indexes.values()].map(x => x.sync(ctx, prev, next)),
            this.onChange(ctx, id, diff),
        ]);
    }

    private _mapToDocs(ids: AsyncIterable<Uuid>): AsyncStream<T> {
        return astream(ids)
            .mapParallel((ctx, id) => this.primary.get(ctx, id))
            .assert(x => x !== undefined)
            .map((_mapCtx, doc) => doc.snapshot());
    }

    private ensureValid(value: T) {
        this.schema.parse(value);
    }
}
