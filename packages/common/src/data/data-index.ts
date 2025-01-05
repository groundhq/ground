import {Condition, mapCondition, Uint8Transaction} from '../kv/kv-store';
import {Uuid, UuidSerializer} from '../uuid';
import {compareIndexKeyPart, IndexKey, KeySerializer} from './key-serializer';

export interface IndexGetOptions {
    order?: 'asc' | 'desc';
}

export interface Index<TValue> {
    sync(prev: TValue | undefined, next: TValue | undefined): Promise<void>;
    get(key: IndexKey): AsyncIterable<Uuid>;
    query(condition: Condition<IndexKey>): AsyncIterable<Uuid>;
}

export interface IndexOptions<TValue> {
    readonly txn: Uint8Transaction;
    readonly idSelector: (value: TValue) => Uuid;
    readonly keySelector: (value: TValue) => IndexKey;
    readonly unique: boolean;
}

export function createIndex<TValue>({txn, idSelector, keySelector, unique}: IndexOptions<TValue>): Index<TValue> {
    const keySerializer = new KeySerializer();
    const uuidSerializer = new UuidSerializer();

    async function* queryInternal(condition: Condition<IndexKey>) {
        const conditionKey = mapCondition(condition, {
            gt: cond => cond.gt,
            gte: cond => cond.gte,
            lt: cond => cond.lt,
            lte: cond => cond.lte,
        });

        const queryCondition = mapCondition<IndexKey, Condition<Uint8Array>>(condition, {
            gt: cond => ({gt: keySerializer.encode(cond.gt)}),
            gte: cond => ({gte: keySerializer.encode(cond.gte)}),
            // we need to add undefined at the end for non-unique indexes (we add document uuid to the end of the index key)
            // undefined has the largest type tag in bytewise serialization
            lt: cond => ({lt: keySerializer.encode([...cond.lt, ...Array(16).fill(undefined)])}),
            lte: cond => ({lte: keySerializer.encode([...cond.lte, ...Array(16).fill(undefined)])}),
        });

        const iterator = txn.query(queryCondition);

        for await (const entry of iterator) {
            const entryKey = keySerializer.decode(entry.key);
            for (let i = 0; i < conditionKey.length - 1; i += 1) {
                if (compareIndexKeyPart(entryKey[i], conditionKey[i]) !== 0) {
                    return;
                }
            }
            yield entry;
        }
    }

    return {
        async sync(prev, next) {
            const prevId = prev && idSelector(prev);
            const nextId = next && idSelector(next);
            const id = prevId ?? nextId;

            if (!id) {
                throw new Error('invalid index sync: at least prev or next must be present');
            }

            if (prev && next && prevId !== nextId) {
                throw new Error('invalid index sync: changing id is not allowed');
            }

            const prevKey = prev && keySelector(prev);
            const nextKey = next && keySelector(next);

            if (prevKey === nextKey) {
                // nothing to do
                return;
            }

            // clean up
            if (prevKey) {
                if (unique) {
                    await txn.delete(keySerializer.encode(prevKey));
                } else {
                    await txn.delete(keySerializer.encode([...prevKey, id]));
                }
            }

            // add
            if (nextKey) {
                if (unique) {
                    const existing = await txn.get(keySerializer.encode(nextKey));
                    if (existing) {
                        throw new Error('unique index constraint violation');
                    }

                    await txn.put(keySerializer.encode(nextKey), uuidSerializer.encode(id));
                } else {
                    await txn.put(keySerializer.encode([...nextKey, id]), uuidSerializer.encode(id));
                }
            }
        },
        async *query(condition) {
            for await (const entry of queryInternal(condition)) {
                yield uuidSerializer.decode(entry.value);
            }
        },
        async *get(key) {
            for await (const entry of queryInternal({gte: key})) {
                const entryKey = keySerializer.decode(entry.key);
                for (let i = 0; i < key.length; i += 1) {
                    if (key.length > 0) {
                        // all parts up to the last were checked in queryInternal
                        if (compareIndexKeyPart(entryKey[key.length - 1], key[key.length - 1]) !== 0) {
                            return;
                        }
                    }
                }

                yield uuidSerializer.decode(entry.value);
            }
        },
    };
}