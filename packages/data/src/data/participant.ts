import {z} from 'zod';
import {Cancellation} from '../cancellation.js';
import {DataAccessor} from './actor.js';
import {Message} from './communication/message.js';
import {PersistentConnection} from './communication/persistent-connection.js';
import {
    createApi,
    handler,
    setupRpcServerConnection,
} from './communication/rpc.js';
import {Connection, TransportClient} from './communication/transport.js';
import {CoordinatorClient} from './coordinator/coordinator-client.js';

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
            createParticipantRpc(),
            this.connection,
            () => ({})
        );
    }

    async sendSignInEmail(email: string, cx: Cancellation) {
        return await this.coordinator.rpc.sendSignInEmail({email}, cx);
    }

    async verifySignInCode(email: string, code: string, cx: Cancellation) {
        return await this.coordinator.rpc.verifySignInCode({email, code}, cx);
    }

    async debug(cx: Cancellation) {
        return await this.coordinator.rpc.debug({}, cx);
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
        await this.connection.close();
    }
}

function createParticipantRpc() {
    return createApi<{}>()({
        echo: handler({
            req: z.object({message: z.string()}),
            res: z.object({message: z.string()}),
            handle: async (_, {message}) => ({message}),
        }),
    });
}

export type ParticipantRpc = ReturnType<typeof createParticipantRpc>;