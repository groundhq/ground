import {Context} from '../../context.js';
import {DataAccessor} from '../actor.js';
import {Message} from '../communication/message.js';
import {PersistentConnection} from '../communication/persistent-connection.js';
import {Connection, TransportClient} from '../communication/transport.js';
import {CoordinatorClient} from '../coordinator/coordinator-client.js';
import {setupRpcServerConnection} from '../rpc/rpc-protocol.js';
import {participantApi} from './participant-client.js';

// todo: add auto reconnect connection (it must buffer messages before sending them to an new connection)
export class Participant {
    private coordinator: CoordinatorClient;
    private readonly connection: Connection<Message>;

    constructor(
        transport: TransportClient<Message>,
        private readonly mode: 'proxy' | 'local'
    ) {
        this.connection = new PersistentConnection(transport);
        this.coordinator = new CoordinatorClient(this.connection);
        setupRpcServerConnection(
            Context.todo(),
            participantApi,
            this.connection,
            {},
            'PRT'
        );
    }

    async sendSignInEmail(ctx: Context, email: string) {
        return await this.coordinator.rpc.sendSignInEmail(ctx, {email});
    }

    async verifySignInCode(ctx: Context, email: string, code: string) {
        return await this.coordinator.rpc.verifySignInCode(ctx, {email, code});
    }

    async debug(ctx: Context) {
        return await this.coordinator.rpc.debug(ctx, {});
    }

    authenticate(authToken: string): void {
        this.coordinator.authenticate(authToken);
    }

    public get data(): DataAccessor {
        return this.coordinator.rpc;
    }

    public get coordinatorRpc() {
        return this.coordinator.rpc;
    }

    async close(): Promise<void> {
        await this.connection.close(Context.todo());
    }
}
