import {Channel} from 'async-channel';
import {MAX_LOOKAHEAD_COUNT} from './constants.js';
import {
    assert,
    assertNever,
    Cancellation,
    CancellationSource,
} from './utils.js';

export interface ColdStreamExecutor<T> {
    next: (value: T) => Promise<void>;
    end: () => void;
    throw: (error: any) => Promise<void>;
    cx: Cancellation;
}

export class HotStream<T> implements AsyncIterable<T> {
    private chan = new Channel<T>();
    private cxs = new CancellationSource();

    get cx() {
        return this.cxs.cancellation;
    }

    end() {
        this.chan.close();
    }

    async next(value: T) {
        await this.chan.push(value);
    }

    async throw(error: any) {
        await this.chan.throw(error);
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        const chan = new Channel<T>(0);

        let complete = false;
        try {
            for await (const item of chan) {
                yield item;
            }

            complete = true;
        } finally {
            if (!complete) {
                this.cxs.cancel();
            }
        }
    }
}

export class ColdStream<T> implements AsyncIterable<T> {
    constructor(
        private readonly execute: (executor: ColdStreamExecutor<T>) => void
    ) {}

    async *[Symbol.asyncIterator](): AsyncIterator<T, any, any> {
        const stream = new HotStream<T>();
        this.execute(stream);
        yield* stream;
    }
}

export class CancellationStream<T> implements AsyncIterable<T> {
    constructor(
        private readonly source: AsyncIterable<T>,
        private readonly cancellation: Promise<void>
    ) {}

    [Symbol.asyncIterator](): AsyncIterator<T, any, any> {
        const iterator = this.source[Symbol.asyncIterator]();
        return {
            next: async (value: any) => {
                const result = await Promise.race([
                    iterator
                        .next(value)
                        .then(value => ({type: 'next' as const, value})),
                    this.cancellation.then(() => ({
                        type: 'cancellation' as const,
                    })),
                ]);

                if (result.type === 'next') {
                    return result.value;
                } else if (result.type === 'cancellation') {
                    return {done: true, value: undefined};
                } else {
                    assertNever(result);
                }
            },
            return: iterator.return
                ? async (value: any) => {
                      return await iterator.return!(value);
                  }
                : undefined,
            throw: iterator.throw
                ? async (error: any) => {
                      return await iterator.throw!(error);
                  }
                : undefined,
        };
    }
}

export function astream<T>(source: AsyncIterable<T> | T[]): AsyncStream<T> {
    if (Array.isArray(source)) {
        return new AsyncStream(
            new ColdStream(async ({next, end}) => {
                for (const item of source) {
                    await next(item);
                }
                end();
            })
        );
    }

    return new AsyncStream(source);
}

export function mergeStreams<T>(source: AsyncIterable<T>[]): AsyncStream<T> {
    return astream(
        new ColdStream(async exe => {
            try {
                let active = source
                    .map(x => x[Symbol.asyncIterator]())
                    .map((iter, id) => ({
                        result: iter.next().then(result => ({result, id})),
                        iter,
                        id,
                    }));
                while (active.length > 0 && !exe.cx.isCancelled) {
                    const {id, result} = await Promise.race(
                        active.map(x => x.result)
                    );
                    if (result.done) {
                        active = active.filter(x => x.id !== id);
                    } else {
                        await exe.next(result.value);
                        const item = active.find(x => x.id === id);
                        assert(item !== undefined);
                        item.result = item.iter
                            .next()
                            .then(result => ({id, result}));
                    }
                }
            } catch (error) {
                await exe.throw(error);
            } finally {
                exe.end();
            }
        })
    );
}

export class AsyncStream<T> implements AsyncIterable<T> {
    constructor(private readonly source: AsyncIterable<T>) {}

    drop(count: number) {
        return astream(this._drop(count));
    }

    take(count: number) {
        return astream(this._take(count));
    }

    assert<S extends T>(validator: (value: T) => value is S): AsyncStream<S> {
        return astream(this._assert(validator)) as AsyncStream<S>;
    }

    private async *_assert(validator: (value: T) => boolean) {
        for await (const item of this.source) {
            assert(validator(item));

            yield item;
        }
    }

    async find(predicate: (value: T) => boolean): Promise<T | undefined> {
        for await (const item of this.source) {
            if (predicate(item)) {
                return item;
            }
        }

        return undefined;
    }

    async some(predicate?: (value: T) => boolean): Promise<boolean> {
        for await (const item of this.source) {
            if (!predicate || predicate(item)) {
                return true;
            }
        }

        return false;
    }

    while<S extends T>(predicate: (value: T) => value is S): AsyncStream<S>;
    while(predicate: (value: T) => boolean): AsyncStream<T>;
    while(
        predicate: ((value: T) => boolean) | ((value: T) => value is T)
    ): AsyncStream<T> {
        return astream(this._while(predicate)) as AsyncStream<any>;
    }

    filter<S extends T>(predicate: (value: T) => value is S): AsyncStream<S>;
    filter(predicate: (value: T) => boolean): AsyncStream<T>;
    filter(
        predicate: ((value: T) => boolean) | ((value: T) => value is T)
    ): AsyncStream<T> {
        return astream(this._filter(predicate)) as AsyncStream<any>;
    }

    map<TResult>(
        mapper: (value: T) => TResult | Promise<TResult>
    ): AsyncStream<TResult> {
        return astream(this._map(mapper));
    }

    private async *_map<TResult>(
        mapper: (value: T) => TResult | Promise<TResult>
    ): AsyncIterable<TResult> {
        for await (const item of this.source) {
            yield await mapper(item);
        }
    }

    mapParallel<TResult>(
        mapper: (value: T) => TResult | Promise<TResult>
    ): AsyncStream<TResult> {
        return astream(
            new ColdStream(async ({next, end}) => {
                let left = 0;
                let right = 0;
                const pending = new Map<number, Promise<TResult> | TResult>();

                for await (const item of this.source) {
                    if (pending.size >= MAX_LOOKAHEAD_COUNT) {
                        assert(pending.has(left));
                        await next(await pending.get(left)!);
                        pending.delete(left);
                        left += 1;
                    }

                    pending.set(right, mapper(item));
                    right += 1;
                }

                for (; left < right; left += 1) {
                    assert(pending.has(left));
                    await next(await pending.get(left)!);
                    pending.delete(left);
                }

                end();
            })
        );
    }

    async toArray(): Promise<T[]> {
        const result: T[] = [];
        for await (const item of this.source) {
            result.push(item);
        }

        return result;
    }

    [Symbol.asyncIterator](): AsyncIterator<T, any, any> {
        return this.source[Symbol.asyncIterator]();
    }

    private async *_while(predicate: (value: T) => boolean) {
        for await (const item of this.source) {
            if (!predicate(item)) break;
            yield item;
        }
    }

    private async *_filter(predicate: (value: T) => boolean) {
        for await (const item of this.source) {
            if (predicate(item)) {
                yield item;
            }
        }
    }

    private async *_take(count: number) {
        if (count === 0) {
            return;
        }

        for await (const item of this.source) {
            yield item;

            count -= 1;
            if (count <= 0) {
                return;
            }
        }
    }

    private async *_drop(count: number) {
        for await (const item of this.source) {
            if (count <= 0) {
                yield item;
            }
            count -= 1;
        }
    }
}
