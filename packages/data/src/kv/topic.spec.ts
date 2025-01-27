import {beforeEach, describe, expect, it} from 'vitest';
import {Codec, StringCodec} from '../codec.js';
import {MemKVStore} from './mem-kv-store.js';
import {Topic, TopicEntry} from './topic.js';

const stringCodec = new StringCodec();
const jsonCodec: Codec<any> = {
    encode: data => stringCodec.encode(JSON.stringify(data)),
    decode: bytes => JSON.parse(stringCodec.decode(bytes)),
};

describe('Topic', () => {
    let store: MemKVStore;

    beforeEach(() => {
        store = new MemKVStore();
    });

    it('should push data into the topic and retrieve it with the correct offsets', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            await topic.push({value: 'A'}, {value: 'B'}, {value: 'C'});

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(0, 3)) {
                results.push(entry);
            }

            expect(results).toEqual([
                {offset: 0, data: {value: 'A'}},
                {offset: 1, data: {value: 'B'}},
                {offset: 2, data: {value: 'C'}},
            ]);
        });
    });

    it('should handle pushing data multiple times and retrieving by ranges', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            await topic.push({value: 'X'}, {value: 'Y'});
            await topic.push({value: 'Z'});

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(1, 3)) {
                results.push(entry);
            }

            expect(results).toEqual([
                {offset: 1, data: {value: 'Y'}},
                {offset: 2, data: {value: 'Z'}},
            ]);
        });
    });

    it('should return an empty list if the range is outside the offsets', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            await topic.push({value: 'A'});

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(2, 5)) {
                results.push(entry);
            }

            expect(results).toEqual([]);
        });
    });

    it('should handle overlapping ranges correctly', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            await topic.push({value: 'D'}, {value: 'E'}, {value: 'F'});

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(0, 2)) {
                results.push(entry);
            }

            expect(results).toEqual([
                {offset: 0, data: {value: 'D'}},
                {offset: 1, data: {value: 'E'}},
            ]);
        });
    });

    it('should support querying with large ranges', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            await topic.push(
                ...Array.from({length: 1000}, (_, i) => ({value: i}))
            );

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(990, 1000)) {
                results.push(entry);
            }

            expect(results).toHaveLength(10);
            expect(results[0]).toEqual({offset: 990, data: {value: 990}});
            expect(results[9]).toEqual({offset: 999, data: {value: 999}});
        });
    });

    it('should increment offset correctly across transactions', async () => {
        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);
            await topic.push({value: 'First'});
        });

        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);
            await topic.push({value: 'Second'});
        });

        await store.transact(async tx => {
            const topic = new Topic(tx, jsonCodec);

            const results: TopicEntry<any>[] = [];
            for await (const entry of topic.list(0, 3)) {
                results.push(entry);
            }

            expect(results).toEqual([
                {offset: 0, data: {value: 'First'}},
                {offset: 1, data: {value: 'Second'}},
            ]);
        });
    });
});
