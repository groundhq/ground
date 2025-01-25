import {z} from 'zod';
import {CrdtDiff} from '../../crdt/crdt.js';
import {BusinessError} from '../../errors.js';
import {Counter} from '../../kv/counter.js';
import {UniqueError} from '../../kv/data-index.js';
import {Uint8Transaction, withPrefix} from '../../kv/kv-store.js';
import {Registry} from '../../kv/registry.js';
import {Brand} from '../../utils.js';
import {Uuid, createUuid, zUuid} from '../../uuid.js';
import {
    Doc,
    DocRepo,
    OnDocChange,
    Recipe,
    SyncTarget,
    zDoc,
} from '../doc-repo.js';
import {createWriteableChecker} from '../update-checker.js';
import {UserId} from './user-repo.js';

export type BoardId = Brand<Uuid, 'board_id'>;

export function createBoardId(): BoardId {
    return createUuid() as BoardId;
}

export interface Board extends Doc<BoardId> {
    readonly slug?: string;
    name: string;
    ownerId: UserId;
    deleted: boolean;
}

const SLUG_INDEX = 'slug';

export function zBoard() {
    return zDoc<BoardId>().extend({
        name: z.string(),
        ownerId: zUuid<UserId>(),
        deleted: z.boolean(),
    });
}

export class BoardRepo implements SyncTarget<Board> {
    public readonly rawRepo: DocRepo<Board>;
    private readonly counters: Registry<Counter>;

    constructor(tx: Uint8Transaction, onChange: OnDocChange<Board>) {
        this.rawRepo = new DocRepo<Board>({
            tx: withPrefix('d/')(tx),
            onChange,
            indexes: {
                [SLUG_INDEX]: {
                    key: x => [x.slug],
                    unique: true,
                    include: x => x.slug !== undefined,
                },
            },
            schema: zBoard(),
        });
        this.counters = new Registry(
            withPrefix('c/')(tx),
            counterTxn => new Counter(counterTxn, 0)
        );
    }

    async apply(id: Uuid, diff: CrdtDiff<Board>): Promise<void> {
        return await this.rawRepo.apply(
            id,
            diff,
            createWriteableChecker({
                deleted: true,
                name: true,
                ownerId: true,
            })
        );
    }

    async getById(id: BoardId): Promise<Board | undefined> {
        return await this.rawRepo.getById(id);
    }

    async incrementBoardCounter(boardId: BoardId): Promise<number> {
        return await this.counters.get(boardId.toString()).increment();
    }

    async checkSlugAvailable(slug: string): Promise<boolean> {
        const existingBoard = await this.rawRepo.getUnique(SLUG_INDEX, [slug]);

        return existingBoard === undefined;
    }

    async create(board: Board): Promise<Board> {
        try {
            return await this.rawRepo.create(board);
        } catch (err) {
            // todo: map errors in AggregateError
            if (err instanceof UniqueError && err.indexName === SLUG_INDEX) {
                throw new BusinessError(
                    `board with slug ${board.slug} already exists`,
                    'board_slug_taken'
                );
            }

            throw err;
        }
    }

    async update(id: BoardId, recipe: Recipe<Board>): Promise<Board> {
        try {
            return await this.rawRepo.update(id, recipe);
        } catch (err) {
            if (err instanceof UniqueError && err.indexName === SLUG_INDEX) {
                throw new BusinessError(
                    'board with slug already exists',
                    'board_slug_taken'
                );
            }

            throw err;
        }
    }
}
