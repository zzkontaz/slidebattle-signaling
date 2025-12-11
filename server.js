const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const rooms = {};
const clientCodeToRoom = {};
function generateRoomCode() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}
wss.on('connection', (ws) => {
    ws.roomCode = null;
    ws.friendCode = null;
    ws.on('message', (message) => {
        try { handleMessage(ws, JSON.parse(message)); } catch (e) { console.error('Invalid JSON', e); }
    });
    ws.on('close', () => {
        if (ws.roomCode && rooms[ws.roomCode]) {
            const room = rooms[ws.roomCode];
            if (ws.friendCode) delete clientCodeToRoom[ws.friendCode];
            if (room.host === ws) {
                if (room.client?.readyState === WebSocket.OPEN) room.client.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                delete rooms[ws.roomCode];
            } else if (room.client === ws) {
                if (room.host?.readyState === WebSocket.OPEN) room.host.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                room.client = null; room.clientCandidate = null; room.clientCandidates = []; room.clientFriendCode = null;
            } else delete rooms[ws.roomCode];
        }
    });
});
function handleMessage(ws, data) {
    switch (data.type) {
        case 'CREATE_ROOM':
            const code = generateRoomCode();
            rooms[code] = { host: ws, client: null, hostCandidate: null, clientCandidate: null, hostCandidates: [], clientCandidates: [], clientFriendCode: null, hostConfirmedClientCode: false };
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'ROOM_CREATED', code }));
            console.log(`Room: ${code}`);
            break;
        case 'JOIN_ROOM':
            const roomCode = data.code, clientFriendCode = data.message;
            if (rooms[roomCode]) {
                if (rooms[roomCode].client) { ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' })); return; }
                rooms[roomCode].client = ws;
                rooms[roomCode].clientFriendCode = clientFriendCode;
                ws.roomCode = roomCode;
                ws.friendCode = clientFriendCode;
                if (clientFriendCode) clientCodeToRoom[clientFriendCode] = roomCode;
                ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', code: roomCode }));
                rooms[roomCode].host.send(JSON.stringify({ type: 'CLIENT_JOINED', clientFriendCode }));
                console.log(`Join: ${roomCode}, code: ${clientFriendCode}`);
            } else ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
            break;
        case 'REGISTER_CANDIDATE':
            const room = rooms[ws.roomCode];
            if (!room) return;
            if (ws === room.host) { room.hostCandidate = { ip: data.ip, port: data.port }; if (data.candidates?.length) room.hostCandidates = data.candidates; }
            else if (ws === room.client) { room.clientCandidate = { ip: data.ip, port: data.port }; if (data.candidates?.length) room.clientCandidates = data.candidates; }
            checkAndExchangeCandidates(room, ws.roomCode);
            break;
        case 'REQUEST_CLIENT_CANDIDATES':
            const confirmedCode = data.code;
            const targetRoom = clientCodeToRoom[confirmedCode];
            if (!targetRoom || !rooms[targetRoom]) { ws.send(JSON.stringify({ type: 'ERROR', message: 'Client code not found' })); return; }
            const r = rooms[targetRoom];
            if (ws !== r.host) return;
            r.hostConfirmedClientCode = true;
            console.log(`Confirmed: ${confirmedCode}`);
            checkAndExchangeCandidates(r, targetRoom);
            break;
    }
}
function checkAndExchangeCandidates(room, roomCode) {
    if (!room.hostCandidate || !room.clientCandidate || !room.hostConfirmedClientCode) return;
    console.log(`MUTUAL PUNCH: ${roomCode}`);
    if (room.host?.readyState === WebSocket.OPEN) room.host.send(JSON.stringify({ type: 'PUNCH_TARGET', candidates: room.clientCandidates.length ? room.clientCandidates : [room.clientCandidate], ip: room.clientCandidate.ip, port: room.clientCandidate.port }));
    if (room.client?.readyState === WebSocket.OPEN) room.client.send(JSON.stringify({ type: 'PUNCH_TARGET', candidates: room.hostCandidates.length ? room.hostCandidates : [room.hostCandidate], ip: room.hostCandidate.ip, port: room.hostCandidate.port }));
}
console.log(`Server on port ${process.env.PORT || 8080}`);
console.log('Mutual Friend Code: ENABLED ✅');
