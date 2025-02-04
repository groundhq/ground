import {z} from 'zod';
import {MsgpackCodec} from '../../codec.js';
import {Uint8KVStore} from '../../kv/kv-store.js';
import {logger} from '../../logger.js';
import {AuthContextParser} from '../auth-context.js';
import {HubClient, HubServer} from '../communication/hub.js';
import {
    MemTransportClient,
    MemTransportServer,
} from '../communication/mem-transport.js';
import {Message} from '../communication/message.js';
import {TransportServer} from '../communication/transport.js';
import {DataLayer} from '../data-layer.js';
import {CryptoService, EmailService, JwtService} from '../infra.js';
import {RpcServer} from '../rpc/rpc.js';
import {getIdentity, signJwtToken} from './auth-api.js';
import {
    CoordinatorApiInputState,
    createCoordinatorApi,
} from './coordinator-api.js';

export class CoordinatorServer {
    private readonly dataLayer: DataLayer;
    private readonly rpcServer: RpcServer<CoordinatorApiInputState>;

    constructor(
        transport: TransportServer<Message>,
        kv: Uint8KVStore,
        private readonly jwt: JwtService,
        private readonly crypto: CryptoService,
        email: EmailService,
        private readonly jwtSecret: string
    ) {
        const hubMemTransportServer = new MemTransportServer(
            new MsgpackCodec()
        );
        const hubMessageSchema = z.void();
        const hubAuthSecret = 'hub-auth-secret';
        const hubServer = new HubServer(
            hubMemTransportServer,
            hubMessageSchema,
            hubAuthSecret
        );

        hubServer.launch().catch(error => {
            logger.error('HubServer failed to launch', error);
        });

        const hubClient = new HubClient(
            new MemTransportClient(hubMemTransportServer, new MsgpackCodec()),
            hubMessageSchema,
            hubAuthSecret
        );

        this.dataLayer = new DataLayer(kv, hubClient, jwtSecret);
        const authContextParser = new AuthContextParser(4, jwt);
        this.rpcServer = new RpcServer(transport, createCoordinatorApi(), {
            authContextParser,
            dataLayer: this.dataLayer,
            jwt,
            crypto,
            emailService: email,
            config: {
                jwtSecret: this.jwtSecret,
            },
        });
    }

    async launch(): Promise<void> {
        await this.rpcServer.launch();
    }

    close() {
        this.rpcServer.close();
    }

    async issueJwtByUserEmail(email: string): Promise<string> {
        return await this.dataLayer.transact(async dataCx => {
            const identity = await getIdentity(
                dataCx.identities,
                dataCx.users,
                email,
                this.crypto
            );

            return signJwtToken(this.jwt, identity, this.jwtSecret);
        });
    }
}

export interface BaseVerifySignInCodeResponse<TType extends string> {
    readonly type: TType;
}

export interface SuccessVerifySignInCodeResponse
    extends BaseVerifySignInCodeResponse<'success'> {
    readonly token: string;
}

export interface InvalidCodeVerifySignInCodeResponse
    extends BaseVerifySignInCodeResponse<'invalid_code'> {}

export interface CodeExpiredVerifySignInCodeResponse
    extends BaseVerifySignInCodeResponse<'code_expired'> {}

export interface CooldownVerifySignInCodeResponse
    extends BaseVerifySignInCodeResponse<'cooldown'> {}

export type VerifySignInCodeResponse =
    | SuccessVerifySignInCodeResponse
    | InvalidCodeVerifySignInCodeResponse
    | CodeExpiredVerifySignInCodeResponse
    | CooldownVerifySignInCodeResponse;
