const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

// Store rooms: { roomCode: { host: ws, client: ws, hostCandidate: {ip, port}, clientCandidate: {ip, port} } }
const rooms = {};

function generateRoomCode() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.roomCode = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Invalid JSON', e);
        }
    });

    ws.on('close', () => {
        if (ws.roomCode && rooms[ws.roomCode]) {
            console.log(`Client disconnected from room ${ws.roomCode}`);
            const room = rooms[ws.roomCode];

            // Notify other peer
            if (room.host === ws && room.client) {
                if (room.client.readyState === WebSocket.OPEN) room.client.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                delete rooms[ws.roomCode];
            } else if (room.client === ws && room.host) {
                if (room.host.readyState === WebSocket.OPEN) room.host.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                room.client = null;
                room.clientCandidate = null;
            } else {
                delete rooms[ws.roomCode];
            }
        }
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'CREATE_ROOM':
            const code = generateRoomCode();
            rooms[code] = { host: ws, client: null, hostCandidate: null, clientCandidate: null };
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'ROOM_CREATED', code: code }));
            console.log(`Room created: ${code}`);
            break;

        case 'JOIN_ROOM':
            const roomCode = data.code;
            if (rooms[roomCode]) {
                if (rooms[roomCode].client) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' }));
                    return;
                }
                rooms[roomCode].client = ws;
                ws.roomCode = roomCode;
                ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', code: roomCode }));
                rooms[roomCode].host.send(JSON.stringify({ type: 'CLIENT_JOINED' }));
                console.log(`Client joined room: ${roomCode}`);
            } else {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
            }
            break;

        case 'REGISTER_CANDIDATE':
            // Peer sends their Public IP:Port (obtained from STUN or locally)
            const room = rooms[ws.roomCode];
            if (!room) return;

            if (ws === room.host) {
                room.hostCandidate = { ip: data.ip, port: data.port };
                console.log(`Host candidate for ${ws.roomCode}: ${data.ip}:${data.port}`);
            } else if (ws === room.client) {
                room.clientCandidate = { ip: data.ip, port: data.port };
                console.log(`Client candidate for ${ws.roomCode}: ${data.ip}:${data.port}`);
            }

            // If both have registered, exchange them!
            if (room.hostCandidate && room.clientCandidate) {
                console.log(`Exchanging candidates for room ${ws.roomCode}`);

                // Send Client's IP to Host (so Host can punch)
                room.host.send(JSON.stringify({
                    type: 'PUNCH_TARGET',
                    ip: room.clientCandidate.ip,
                    port: room.clientCandidate.port
                }));

                // Send Host's IP to Client (so Client can punch)
                room.client.send(JSON.stringify({
                    type: 'PUNCH_TARGET',
                    ip: room.hostCandidate.ip,
                    port: room.hostCandidate.port
                }));
            }
            break;
    }
}

console.log(`Signaling server running on port ${process.env.PORT || 8080}`);
