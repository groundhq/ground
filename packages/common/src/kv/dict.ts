import {Uint8Transaction, withPrefix} from './kv-store';

export class Dict<T> {
    constructor(
        private readonly txn: Uint8Transaction,
        private readonly factory: (txn: Uint8Transaction) => T
    ) {}

    get(name: string): T {
        if (name.indexOf('/') !== -1) {
            throw new Error('invalid item name, / is not allowed');
        }

        return this.factory(withPrefix(`t/${name}/`)(this.txn));
    }
}