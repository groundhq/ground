import {z} from 'zod';
import {astream, AsyncStream, ColdStream} from './async-stream.js';
import {CancelledError, Context} from './context.js';
import {Deferred} from './deferred.js';
import {
    AggregateBusinessError,
    AggregateError,
    BusinessError,
} from './errors.js';

export type Brand<T, B> = T & {__brand: B | undefined};

export interface Observer<T> {
    next: (ctx: Context, value: T) => Promise<void>;
    throw: (ctx: Context, error: unknown) => Promise<void>;
    close: (ctx: Context) => Promise<void>;
}

export class Subject<TValue> {
    private subs: Array<{observer: Observer<TValue>}> = [];
    private _open = true;

    get open() {
        return this._open;
    }

    get anyObservers(): boolean {
        return this.subs.length > 0;
    }

    subscribe(ctx: Context, observer: Observer<TValue>): void {
        this.ensureOpen();

        // wrap if the same observer is used twice for subscription, so unsubscribe wouldn't filter both out
        const sub = {observer};

        this.subs.push(sub);
        ctx.cleanup(() => {
            this.subs = this.subs.filter(x => x !== sub);
        });
    }

    value$(ctx: Context): AsyncStream<TValue> {
        const stream = new ColdStream<TValue>(ctx, (executorCtx, exe) => {
            const [ctx, cancel] = executorCtx.withCancel();
            this.subscribe(ctx, {
                next: (ctx, value) => exe.next(ctx, value),
                throw: (ctx, error) => exe.throw(ctx, error),
                close: ctx => exe.end(ctx),
            });

            return cancel;
        });
        return astream(stream);
    }

    async next(ctx: Context, value: TValue): Promise<void> {
        this.ensureOpen();
        // copy in case if new subscribers are added/removed during notification
        // await whenAll([...this.subs].map(sub => sub.observer.next(ctx, value)));

        // to preserve stack
        for (const sub of [...this.subs]) {
            await sub.observer.next(ctx, value);
        }
    }

    async throw(ctx: Context, error: unknown): Promise<void> {
        this.ensureOpen();
        // copy in case if new subscribers are added/removed during notification
        // await whenAll(
        //     [...this.subs].map(sub =>
        //         sub.observer.throw(ctx, new ForwardedError(error))
        //     )
        // );

        // to preserve stack
        for (const sub of [...this.subs]) {
            await sub.observer.throw(
                ctx,
                new Error('Subject.throw', {cause: error})
            );
        }
    }

    async close(ctx: Context): Promise<void> {
        if (this._open) {
            this._open = false;
            // copy in case if new subscribers are added/removed during notification
            // await whenAll([...this.subs].map(sub => sub.observer.close(ctx)));

            // to preserve stack
            for (const sub of [...this.subs]) {
                await sub.observer.close(ctx);
            }
        } else {
            console.warn('[WRN] subject already closed');
        }
    }

    private ensureOpen() {
        if (!this._open) {
            throw new Error('subject is closed');
        }
    }
}

export function assertNever(value: never): never {
    throw new Error('assertNever failed: ' + value);
}

export function assert(expression: boolean): asserts expression {
    if (!expression) {
        throw new Error('assertion failed');
    }
}

export function assertDefined<T>(value: T | undefined | null): T {
    if (value === null || value === undefined) {
        throw new Error('assertion failed: value is not defined');
    }

    return value;
}

export function wait(ctx: Context, ms: number): Promise<void> {
    const result = new Deferred<void>();
    const timeoutId = setTimeout(() => result.resolve(), ms);
    // create CancelledError here to preserve call stack
    const cancelError = new CancelledError();
    ctx.cleanup(() => {
        result.reject(cancelError);
        clearTimeout(timeoutId);
    });
    return result.promise;
}

export function isCancelledError(error: unknown) {
    return (
        error instanceof CancelledError ||
        (error instanceof Error && isCancelledError(error.cause))
    );
}

export async function ignoreCancel<T>(promise: Promise<T>): Promise<T | never> {
    try {
        return await promise;
    } catch (error) {
        if (isCancelledError(error)) {
            return new Promise(() => {});
        }
        return await Promise.reject(error);
    }
}

export function interval(ms: number, ctx: Context): AsyncStream<number> {
    return astream(_interval(ctx, ms));
}

async function* _interval(ctx: Context, ms: number): AsyncIterable<number> {
    let index = 0;
    while (ctx.alive) {
        ctx.ensureAlive();
        yield index;
        index += 1;
        await wait(ctx, ms);
    }
}

export function pipe<T>(x: T): T;
export function pipe<T, R>(x: T, fn1: (x: T) => R): R;
export function pipe<T, A, R>(x: T, fn1: (x: T) => A, fn2: (arg: A) => R): R;
export function pipe<T, A, B, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => R
): R;
export function pipe<T, A, B, C, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => C,
    fn4: (arg: C) => R
): R;
export function pipe<T, A, B, C, D, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => C,
    fn4: (arg: C) => D,
    fn5: (arg: D) => R
): R;
export function pipe<T, A, B, C, D, E, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => C,
    fn4: (arg: C) => D,
    fn5: (arg: D) => E,
    fn6: (arg: E) => R
): R;
export function pipe<T, A, B, C, D, E, F, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => C,
    fn4: (arg: C) => D,
    fn5: (arg: D) => E,
    fn6: (arg: E) => F,
    fn7: (arg: F) => R
): R;
export function pipe<T, A, B, C, D, E, F, G, R>(
    x: T,
    fn1: (x: T) => A,
    fn2: (arg: A) => B,
    fn3: (arg: B) => C,
    fn4: (arg: C) => D,
    fn5: (arg: D) => E,
    fn6: (arg: E) => F,
    fn7: (arg: F) => G,
    fn8: (arg: G) => R
): R;
export function pipe<T>(x: T, ...fns: Function[]): any {
    if (fns.length === 0) {
        return x;
    }
    return fns.reduce((prevResult, fn) => fn(prevResult), x as unknown);
}

export function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
    const mergedArray = new Uint8Array(a.length + b.length);
    mergedArray.set(a);
    mergedArray.set(b, a.length);

    return mergedArray;
}

export function distinct<T>(items: T[]): T[] {
    return [...new Set(items).values()];
}

export function zip<T1, T2>(a: readonly T1[], b: readonly T2[]): [T1, T2][] {
    assert(a.length === b.length);

    const result: [T1, T2][] = [];
    for (let i = 0; i < a.length; i += 1) {
        result.push([a[i], b[i]]);
    }

    return result;
}

export function compareUint8Array(a: Uint8Array, b: Uint8Array): 1 | 0 | -1 {
    const minLength = Math.min(a.length, b.length);

    for (let i = 0; i < minLength; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }

    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;

    return 0;
}

export function bufStartsWith(buf: Uint8Array, prefix: Uint8Array): boolean {
    const bufPrefix = buf.slice(0, prefix.length);
    return compareUint8Array(bufPrefix, prefix) === 0;
}

export function unreachable(): never {
    throw new Error('unreachable');
}

export function unimplemented(): never {
    throw new Error('unimplemented');
}

export function arrayEqual<T>(a: T[], b: T[]) {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

/**
 * In contrast to Promise.all, whenAll waits for all rejections and combines them into AggregateError
 */
export async function whenAll<const T extends Promise<any>[]>(
    promises: T
): ReturnType<typeof Promise.all<T>> {
    const result = await Promise.allSettled(promises);
    const rejected = result.filter(x => x.status === 'rejected');

    if (rejected.length === 0) {
        return result
            .filter(x => x.status === 'fulfilled')
            .map(x => x.value) as any;
    } else if (rejected.length === 1) {
        throw rejected[0].reason;
    } else {
        if (rejected.every(x => x.reason instanceof BusinessError)) {
            throw new AggregateBusinessError(rejected.map(x => x.reason));
        } else {
            throw new AggregateError(rejected.map(x => x.reason));
        }
    }
}

export async function whenAny<T>(promises: Promise<T>[]) {
    assert(promises.length > 0);

    const withId = promises.map((promise, idx) =>
        promise.then(result => ({result, idx}))
    );
    const racer = await Promise.race(withId);

    return [
        racer.result,
        promises.filter((_, idx) => idx !== racer.idx),
    ] as const;
}

export function zUint8Array() {
    return z.custom<Uint8Array>(x => x instanceof Uint8Array, {
        message: 'Uint8Array expected',
    });
}
