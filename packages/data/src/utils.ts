export type Brand<T, B> = T & {__brand: B | undefined};

export type Unsubscribe = () => void;

export function assertNever(value: never): never {
    throw new Error('assertNever failed: ' + value);
}

export function assert(expression: boolean): asserts expression {
    if (!expression) {
        throw new Error('assertion failed');
    }
}

export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function pipe<T, R>(x: T, fn1: (x: T) => R): R;
export function pipe<T, A, R>(x: T, fn1: (x: T) => A, fn2: (arg: A) => R): R;
export function pipe<T, A, B, R>(x: T, fn1: (x: T) => A, fn2: (arg: A) => B, fn3: (arg: B) => R): R;
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
    var mergedArray = new Uint8Array(a.length + b.length);
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