export type UpdateChecker<T> = (prev: T, next: T) => {errors: string[]} | void;

type WritableMap<T> = {
    [K in WritableKeys<T>]-?: IfEquals<
        {[P in K]: T[K]},
        {-readonly [P in K]: T[K]}
    >;
};

type WritableKeys<T> = {
    [K in keyof T]-?: IfEquals<
        {[P in K]: T[K]},
        {-readonly [P in K]: T[K]}
    > extends true
        ? K
        : never;
}[keyof T];

type IfEquals<X, Y> =
    (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2
        ? true
        : false;

export function createWriteableChecker<T extends object>(
    writable: WritableMap<Omit<T, 'updatedAt' | 'createdAt' | 'id'>>
) {
    return (prev: T, next: T) => {
        const keys = new Set([
            ...Object.keys(prev),
            ...Object.keys(next),
        ]) as Set<keyof T>;
        const errors: string[] = [];
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new Error(
                    'property (with non-string name) modification is not allowed: ' +
                        String(key)
                );
            }

            if (prev[key] !== next[key] && (writable as any)[key] === true) {
                errors.push(`property ${key} is not writable`);
            }
        }

        if (errors.length > 0) {
            return {errors};
        }

        return;
    };
}
export function combineUpdateCheckers<T>(
    checkers: Array<UpdateChecker<T>>
): UpdateChecker<T> {
    return checkers.reduce<UpdateChecker<T>>(
        (a, b) => (prev: T, next: T) => {
            const aResult = a(prev, next);
            const bResult = b(prev, next);
            const errors: string[] = [];
            if (aResult) errors.push(...aResult.errors);
            if (bResult) errors.push(...bResult.errors);

            if (errors.length > 0) {
                return {errors};
            }

            return;
        },
        () => {}
    );
}
