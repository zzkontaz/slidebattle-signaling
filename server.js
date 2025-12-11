const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
// Store rooms with ICE candidates and friend codes
const rooms = {};
// Map client friend codes to room codes for lookup
const clientCodeToRoom = {};
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
    ws.friendCode = null;
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
            
            // Clean up friend code mapping
            if (ws.friendCode && clientCodeToRoom[ws.friendCode]) {
                delete clientCodeToRoom[ws.friendCode];
            }
            
            if (room.host === ws && room.client) {
                if (room.client.readyState === WebSocket.OPEN) {
                    room.client.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                }
                delete rooms[ws.roomCode];
            } else if (room.client === ws && room.host) {
                if (room.host.readyState === WebSocket.OPEN) {
                    room.host.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
                }
                room.client = null;
                room.clientCandidate = null;
                room.clientCandidates = [];
                room.clientFriendCode = null;
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
            rooms[code] = { 
                host: ws, 
                client: null, 
                hostCandidate: null, 
                clientCandidate: null,
                hostCandidates: [],
                clientCandidates: [],
                clientFriendCode: null,
                hostConfirmedClientCode: false
            };
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'ROOM_CREATED', code: code }));
            console.log(`Room created: ${code}`);
            break;
        case 'JOIN_ROOM':
            const roomCode = data.code;
            const clientFriendCode = data.message; // Client's friend code
            
            if (rooms[roomCode]) {
                if (rooms[roomCode].client) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' }));
                    return;
                }
                rooms[roomCode].client = ws;
                rooms[roomCode].clientFriendCode = clientFriendCode;
                ws.roomCode = roomCode;
                ws.friendCode = clientFriendCode;
                
                // Store friend code mapping for lookup
                if (clientFriendCode) {
                    clientCodeToRoom[clientFriendCode] = roomCode;
                }
                
                ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', code: roomCode }));
                
                // Notify host with client's friend code
                rooms[roomCode].host.send(JSON.stringify({ 
                    type: 'CLIENT_JOINED',
                    clientFriendCode: clientFriendCode
                }));
                
                console.log(`Client joined room: ${roomCode} with friend code: ${clientFriendCode}`);
            } else {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
            }
            break;
        case 'REGISTER_CANDIDATE':
            const room = rooms[ws.roomCode];
            if (!room) return;
            if (ws === room.host) {
                room.hostCandidate = { ip: data.ip, port: data.port };
                console.log(`Host candidate for ${ws.roomCode}: ${data.ip}:${data.port}`);
                
                if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
                    room.hostCandidates = data.candidates;
                    console.log(`Host registered ${data.candidates.length} ICE candidates`);
                }
            } else if (ws === room.client) {
                room.clientCandidate = { ip: data.ip, port: data.port };
                console.log(`Client candidate for ${ws.roomCode}: ${data.ip}:${data.port}`);
                
                if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
                    room.clientCandidates = data.candidates;
                    console.log(`Client registered ${data.candidates.length} ICE candidates`);
                }
            }
            // Check if we can exchange (need both candidates AND host confirmed client code)
            checkAndExchangeCandidates(room, ws.roomCode);
            break;
        case 'REQUEST_CLIENT_CANDIDATES':
            // Host confirmed client's friend code - trigger exchange
            const confirmedCode = data.code;
            const targetRoom = clientCodeToRoom[confirmedCode];
            
            if (!targetRoom || !rooms[targetRoom]) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Client code not found' }));
                console.log(`Client code not found: ${confirmedCode}`);
                return;
            }
            
            const r = rooms[targetRoom];
            if (ws !== r.host) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Only host can confirm client code' }));
                return;
            }
            
            r.hostConfirmedClientCode = true;
            console.log(`Host confirmed client code: ${confirmedCode} for room: ${targetRoom}`);
            
            // Now exchange candidates
            checkAndExchangeCandidates(r, targetRoom);
            break;
    }
}
function checkAndExchangeCandidates(room, roomCode) {
    // Need both candidates AND host confirmation for exchange
    if (!room.hostCandidate || !room.clientCandidate) {
        console.log(`Waiting for candidates - host: ${!!room.hostCandidate}, client: ${!!room.clientCandidate}`);
        return;
    }
    
    if (!room.hostConfirmedClientCode) {
        console.log(`Waiting for host to confirm client code`);
        return;
    }
    
    console.log(`Exchanging candidates for room ${roomCode} (MUTUAL PUNCH!)`);
    
    // Send Client's candidates to Host
    if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({
            type: 'PUNCH_TARGET',
            candidates: room.clientCandidates.length > 0 ? room.clientCandidates : [room.clientCandidate],
            ip: room.clientCandidate.ip,
            port: room.clientCandidate.port
        }));
        console.log(`Sent client candidates to host for MUTUAL PUNCH`);
    }
    // Send Host's candidates to Client
    if (room.client && room.client.readyState === WebSocket.OPEN) {
        room.client.send(JSON.stringify({
            type: 'PUNCH_TARGET',
            candidates: room.hostCandidates.length > 0 ? room.hostCandidates : [room.hostCandidate],
            ip: room.hostCandidate.ip,
            port: room.hostCandidate.port
        }));
        console.log(`Sent host candidates to client for MUTUAL PUNCH`);
    }
}
console.log(`Signaling server running on port ${process.env.PORT || 8080}`);
console.log('Mutual Friend Code Exchange: ENABLED ✅');
