import {z} from 'zod';
import {Crdt} from '../../crdt/crdt.js';
import {logger} from '../../logger.js';
import {getNow} from '../../timestamp.js';
import {observable, wait} from '../../utils.js';
import {EventStoreReader} from '../communication/event-store.js';
import {ChangeEvent, Transact} from '../data-layer.js';
import {createUserId, User} from '../repos/user-repo.js';
import {createApi, handler, observer, streamer} from '../rpc/rpc.js';

export interface TestApiState {
    esReader: EventStoreReader<ChangeEvent>;
    transact: Transact;
}

export function createTestApi() {
    return createApi<TestApiState>()({
        getArr: streamer({
            req: z.object({}),
            item: z.number(),
            async *stream(cx) {
                yield 1;
                await wait(1000);
                yield 2;
                await wait(1000);
                yield 3;
                await wait(1000);
                yield 4;
                await wait(1000);
                yield 5;
            },
        }),
        echo: handler({
            req: z.object({msg: z.string()}),
            res: z.object({msg: z.string()}),
            handle: async (state, {msg}) => {
                return {msg};
            },
        }),
        // streaming example
        getStream: streamer({
            req: z.object({topic: z.string()}),
            item: z.object({index: z.number(), value: z.string()}),
            async *stream({esReader}, {topic}) {
                logger.debug('stream start');
                let index = 1;
                while (true) {
                    logger.debug('stream yield');
                    yield {index: index++, value: 'sdf'};
                    await wait(1000);
                }
            },
        }),
        getObserve: observer({
            req: z.object({topic: z.string()}),
            value: z.object({index: z.number(), value: z.string()}),
            update: z.object({index: z.number(), value: z.string()}),
            async observe({esReader}, {topic}) {
                return observable({
                    async get() {
                        return {index: 1, value: 'sdf'};
                    },
                    update$: esReader
                        .subscribe(topic, 0)
                        .then(x => x.map(() => undefined)),
                });
            },
        }),
        streamPut: handler({
            req: z.object({topic: z.string(), value: z.string()}),
            res: z.object({}),
            handle: async (state, {topic, value}) => {
                await state.transact(async tx => {
                    await tx.esWriter.append(topic, {
                        type: 'user',
                        id: createUserId(),
                        ts: getNow(),
                        diff: Crdt.from<User>({
                            id: createUserId(),
                            createdAt: getNow(),
                            updatedAt: getNow(),
                        }).state(),
                    });
                });
                return {};
            },
        }),
    });
}
