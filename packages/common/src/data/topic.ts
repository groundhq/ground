import {Encoder} from '../encoder';
import {Counter} from '../kv/counter';
import {Transaction, Uint8Transaction, withKeyEncoder, withPrefix, withValueEncoder} from '../kv/kv-store';
import {NumberEncoder} from '../kv/number-encoder';
import {pipe} from '../utils';

export interface TopicEntry<T> {
    readonly offset: number;
    readonly data: T;
}

export class Topic<T> {
    private readonly counter: Counter;
    private readonly log: Transaction<number, T>;

    constructor(txn: Uint8Transaction, dataEncoder: Encoder<T>) {
        this.counter = new Counter(pipe(txn, withPrefix('i/')), 0);
        this.log = pipe(txn, withPrefix('l/'), withKeyEncoder(new NumberEncoder()), withValueEncoder(dataEncoder));
    }

    async push(...data: T[]): Promise<void> {
        const offset = (await this.counter.increment(data.length)) - data.length;
        await Promise.all(data.map((x, idx) => this.log.put(offset + idx, x)));
    }

    async *list(start: number, end: number): AsyncIterable<TopicEntry<T>> {
        for await (const {key, value} of this.log.query({gte: start})) {
            if (key >= end) return;

            yield {offset: key, data: value};
        }
    }
}
