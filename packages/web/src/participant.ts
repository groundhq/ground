import {ConsoleLogger, MsgpackrCodec, Participant, ReconnectConnection} from 'ground-data';
import {WsTransportClient} from './ws-transport-client.js';

function createParticipant() {
    const transport = new WsTransportClient({
        url: 'ws://localhost:4567',
        codec: new MsgpackrCodec(),
        logger: new ConsoleLogger(),
    });
    const connection = new ReconnectConnection(transport);
    const participant = new Participant(connection);

    return participant;
}

export const participant = createParticipant();