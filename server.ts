import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database for persistent boards
const db = new Database(path.join(__dirname, 'boards.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    room_code TEXT PRIMARY KEY,
    host_token TEXT NOT NULL,
    all_guests_locked INTEGER NOT NULL DEFAULT 0,
    board_state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

interface BoardStatePayload {
  pageCols: number;
  pageRows: number;
  lines: any[];
  shapes: any[];
  texts: any[];
  media: any[];
}

interface Participant {
  userId: string;
  name: string;
  color: string;
  isHost: boolean;
  canWrite: boolean;
  cursor: { x: number; y: number } | null;
  ws: WebSocket;
}

interface ActiveRoom {
  roomCode: string;
  hostToken: string;
  allGuestsLocked: boolean;
  boardState: BoardStatePayload;
  participants: Map<string, Participant>;
  savedPermissions: Map<string, boolean>; // userId -> canWrite across reconnects
}

const CURSOR_COLORS = [
  '#2563EB', // Royal Blue
  '#16A34A', // Emerald
  '#D97706', // Amber
  '#DC2626', // Crimson
  '#7C3AED', // Violet
  '#0891B2', // Cyan
  '#DB2777', // Pink
];

const rooms = new Map<string, ActiveRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function loadOrGetRoom(roomCode: string): ActiveRoom | null {
  const code = roomCode.toUpperCase();
  if (rooms.has(code)) {
    return rooms.get(code)!;
  }

  const row = db
    .prepare('SELECT room_code, host_token, all_guests_locked, board_state_json FROM boards WHERE room_code = ?')
    .get(code) as
    | {
        room_code: string;
        host_token: string;
        all_guests_locked: number;
        board_state_json: string;
      }
    | undefined;

  if (!row) return null;

  let parsedState: BoardStatePayload = {
    pageCols: 1,
    pageRows: 1,
    lines: [],
    shapes: [],
    texts: [],
    media: [],
  };

  try {
    parsedState = JSON.parse(row.board_state_json);
  } catch (e) {
    console.error('Failed to parse board_state_json for room', code, e);
  }

  const room: ActiveRoom = {
    roomCode: row.room_code,
    hostToken: row.host_token,
    allGuestsLocked: Boolean(row.all_guests_locked),
    boardState: parsedState,
    participants: new Map(),
    savedPermissions: new Map(),
  };

  rooms.set(code, room);
  return room;
}

function persistRoom(room: ActiveRoom) {
  try {
    db.prepare(
      `INSERT INTO boards (room_code, host_token, all_guests_locked, board_state_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_code) DO UPDATE SET
         all_guests_locked = excluded.all_guests_locked,
         board_state_json = excluded.board_state_json,
         updated_at = excluded.updated_at`
    ).run(
      room.roomCode,
      room.hostToken,
      room.allGuestsLocked ? 1 : 0,
      JSON.stringify(room.boardState),
      Date.now()
    );
  } catch (err) {
    console.error('Error persisting room to SQLite:', err);
  }
}

function serializeParticipants(room: ActiveRoom) {
  return Array.from(room.participants.values()).map((p) => ({
    userId: p.userId,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    canWrite: p.isHost ? true : p.canWrite,
    effectiveCanWrite: p.isHost ? true : p.canWrite && !room.allGuestsLocked,
    cursor: p.cursor,
  }));
}

function broadcastToRoom(room: ActiveRoom, message: any, excludeUserId?: string) {
  const payload = JSON.stringify(message);
  for (const [uid, participant] of room.participants.entries()) {
    if (excludeUserId && uid === excludeUserId) continue;
    if (participant.ws.readyState === WebSocket.OPEN) {
      participant.ws.send(payload);
    }
  }
}

function canParticipantWrite(room: ActiveRoom, participant: Participant): boolean {
  if (participant.isHost) return true;
  if (room.allGuestsLocked) return false;
  return participant.canWrite;
}

function applyBoardDelta(room: ActiveRoom, op: any): boolean {
  const state = room.boardState;
  switch (op.type) {
    case 'upsert-line': {
      const item = op.item;
      if (!item || !item.id) return false;
      const idx = state.lines.findIndex((l: any) => l.id === item.id);
      if (idx >= 0) {
        state.lines[idx] = item;
      } else {
        state.lines.push(item);
      }
      return true;
    }
    case 'upsert-shape': {
      const item = op.item;
      if (!item || !item.id) return false;
      const idx = state.shapes.findIndex((s: any) => s.id === item.id);
      if (idx >= 0) {
        state.shapes[idx] = item;
      } else {
        state.shapes.push(item);
      }
      return true;
    }
    case 'upsert-text': {
      const item = op.item;
      if (!item || !item.id) return false;
      const idx = state.texts.findIndex((t: any) => t.id === item.id);
      if (idx >= 0) {
        state.texts[idx] = item;
      } else {
        state.texts.push(item);
      }
      return true;
    }
    case 'upsert-media': {
      const item = op.item;
      if (!item || !item.id) return false;
      const idx = state.media.findIndex((m: any) => m.id === item.id);
      if (idx >= 0) {
        state.media[idx] = item;
      } else {
        state.media.push(item);
      }
      return true;
    }
    case 'delete-item': {
      const id = op.id;
      if (!id) return false;
      state.lines = state.lines.filter((l: any) => l.id !== id);
      state.shapes = state.shapes.filter((s: any) => s.id !== id);
      state.texts = state.texts.filter((t: any) => t.id !== id);
      state.media = state.media.filter((m: any) => m.id !== id);
      return true;
    }
    case 'clear-board': {
      state.lines = [];
      state.shapes = [];
      state.texts = [];
      state.media = [];
      return true;
    }
    case 'page-resize': {
      if (typeof op.pageCols === 'number') state.pageCols = Math.max(1, op.pageCols);
      if (typeof op.pageRows === 'number') state.pageRows = Math.max(1, op.pageRows);
      return true;
    }
    case 'full-sync': {
      if (op.boardState) {
        room.boardState = {
          pageCols: op.boardState.pageCols || 1,
          pageRows: op.boardState.pageRows || 1,
          lines: Array.isArray(op.boardState.lines) ? op.boardState.lines : [],
          shapes: Array.isArray(op.boardState.shapes) ? op.boardState.shapes : [],
          texts: Array.isArray(op.boardState.texts) ? op.boardState.texts : [],
          media: Array.isArray(op.boardState.media) ? op.boardState.media : [],
        };
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

  // REST endpoint to check if a room exists
  app.get('/api/rooms/:code', (req, res) => {
    const room = loadOrGetRoom(req.params.code);
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      roomCode: room.roomCode,
      participantCount: room.participants.size,
      allGuestsLocked: room.allGuestsLocked,
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let currentRoomCode: string | null = null;
    let currentUserId: string | null = null;

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // 1. Host creates a new room
      if (msg.type === 'room:create') {
        let code = generateRoomCode();
        while (loadOrGetRoom(code) !== null) {
          code = generateRoomCode();
        }
        const hostToken = uuidv4();
        const userId = msg.userId || uuidv4();
        const name = (msg.name || 'Host').trim().slice(0, 32) || 'Host';

        const initialBoard: BoardStatePayload = {
          pageCols: msg.boardState?.pageCols || 1,
          pageRows: msg.boardState?.pageRows || 1,
          lines: Array.isArray(msg.boardState?.lines) ? msg.boardState.lines : [],
          shapes: Array.isArray(msg.boardState?.shapes) ? msg.boardState.shapes : [],
          texts: Array.isArray(msg.boardState?.texts) ? msg.boardState.texts : [],
          media: Array.isArray(msg.boardState?.media) ? msg.boardState.media : [],
        };

        const room: ActiveRoom = {
          roomCode: code,
          hostToken,
          allGuestsLocked: false,
          boardState: initialBoard,
          participants: new Map(),
          savedPermissions: new Map(),
        };

        const hostParticipant: Participant = {
          userId,
          name,
          color: CURSOR_COLORS[0],
          isHost: true,
          canWrite: true,
          cursor: null,
          ws,
        };

        room.participants.set(userId, hostParticipant);
        rooms.set(code, room);
        persistRoom(room);

        currentRoomCode = code;
        currentUserId = userId;

        ws.send(
          JSON.stringify({
            type: 'room:init',
            roomCode: code,
            hostToken,
            userId,
            isHost: true,
            canWrite: true,
            effectiveCanWrite: true,
            allGuestsLocked: room.allGuestsLocked,
            boardState: room.boardState,
            participants: serializeParticipants(room),
          })
        );
        return;
      }

      // 2. Join an existing room (as returning host or guest)
      if (msg.type === 'room:join') {
        const code = String(msg.roomCode || '').trim().toUpperCase();
        const room = loadOrGetRoom(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'room:error', message: `Room "${code}" was not found.` }));
          return;
        }

        const userId = msg.userId || uuidv4();
        const isHost = Boolean(msg.hostToken && msg.hostToken === room.hostToken);
        const defaultName = isHost ? 'Host' : `Guest ${room.participants.size + 1}`;
        const name = String(msg.name || defaultName).trim().slice(0, 32) || defaultName;
        const colorIndex = room.participants.size % CURSOR_COLORS.length;

        // Guests are view-only by default unless previously granted permission in this session
        const previousCanWrite = room.savedPermissions.get(userId) ?? false;
        const canWrite = isHost ? true : previousCanWrite;

        // Close previous socket for same userId if reconnecting
        const existing = room.participants.get(userId);
        if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close();
        }

        const participant: Participant = {
          userId,
          name,
          color: existing?.color || CURSOR_COLORS[colorIndex],
          isHost,
          canWrite,
          cursor: null,
          ws,
        };

        room.participants.set(userId, participant);
        currentRoomCode = code;
        currentUserId = userId;

        ws.send(
          JSON.stringify({
            type: 'room:init',
            roomCode: room.roomCode,
            hostToken: isHost ? room.hostToken : undefined,
            userId,
            isHost,
            canWrite,
            effectiveCanWrite: canParticipantWrite(room, participant),
            allGuestsLocked: room.allGuestsLocked,
            boardState: room.boardState,
            participants: serializeParticipants(room),
          })
        );

        broadcastToRoom(
          room,
          {
            type: 'participants:updated',
            allGuestsLocked: room.allGuestsLocked,
            participants: serializeParticipants(room),
            eventNotice: `${name} joined the board`,
          },
          userId
        );
        return;
      }

      if (!currentRoomCode || !currentUserId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const sender = room.participants.get(currentUserId);
      if (!sender) return;

      // 3. Cursor movement (allowed for all connected participants)
      if (msg.type === 'cursor:move') {
        sender.cursor = msg.cursor ? { x: Number(msg.cursor.x), y: Number(msg.cursor.y) } : null;
        broadcastToRoom(
          room,
          {
            type: 'cursor:updated',
            userId: sender.userId,
            name: sender.name,
            color: sender.color,
            cursor: sender.cursor,
          },
          sender.userId
        );
        return;
      }

      // 4. Ping arrow on board (allowed for writers)
      if (msg.type === 'board:ping') {
        if (!canParticipantWrite(room, sender)) return;
        broadcastToRoom(
          room,
          {
            type: 'board:ping',
            pointer: {
              id: msg.pointer?.id || uuidv4(),
              x: Number(msg.pointer?.x || 0),
              y: Number(msg.pointer?.y || 0),
              color: sender.color,
              name: sender.name,
            },
          },
          sender.userId
        );
        return;
      }

      // 5. Board operations (strictly gated by server-side write permission!)
      if (msg.type === 'board:op') {
        if (!canParticipantWrite(room, sender)) {
          ws.send(
            JSON.stringify({
              type: 'permission:denied',
              message: 'You currently have View-Only access on this board.',
            })
          );
          return;
        }

        const changed = applyBoardDelta(room, msg.op);
        if (changed) {
          persistRoom(room);
          broadcastToRoom(
            room,
            {
              type: 'board:op',
              op: msg.op,
              senderId: sender.userId,
            },
            sender.userId
          );
        }
        return;
      }

      // 6. Host-only moderation actions
      if (msg.type === 'permission:setUser') {
        if (!sender.isHost) return;
        const targetId = String(msg.targetUserId || '');
        const nextWrite = Boolean(msg.canWrite);
        const target = room.participants.get(targetId);
        if (target && !target.isHost) {
          target.canWrite = nextWrite;
          room.savedPermissions.set(targetId, nextWrite);

          if (target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(
              JSON.stringify({
                type: 'permission:changed',
                canWrite: target.canWrite,
                effectiveCanWrite: canParticipantWrite(room, target),
                allGuestsLocked: room.allGuestsLocked,
                notice: nextWrite
                  ? 'The host granted you write access.'
                  : 'The host switched your access to View-Only.',
              })
            );
          }

          broadcastToRoom(room, {
            type: 'participants:updated',
            allGuestsLocked: room.allGuestsLocked,
            participants: serializeParticipants(room),
          });
        }
        return;
      }

      if (msg.type === 'permission:setGlobalLock') {
        if (!sender.isHost) return;
        room.allGuestsLocked = Boolean(msg.allGuestsLocked);
        persistRoom(room);

        // Notify every guest of their new effective write state
        for (const p of room.participants.values()) {
          if (!p.isHost && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(
              JSON.stringify({
                type: 'permission:changed',
                canWrite: p.canWrite,
                effectiveCanWrite: canParticipantWrite(room, p),
                allGuestsLocked: room.allGuestsLocked,
                notice: room.allGuestsLocked
                  ? 'The host locked board editing for all guests.'
                  : 'The host unlocked guest permissions.',
              })
            );
          }
        }

        broadcastToRoom(room, {
          type: 'participants:updated',
          allGuestsLocked: room.allGuestsLocked,
          participants: serializeParticipants(room),
        });
        return;
      }

      if (msg.type === 'participant:kick') {
        if (!sender.isHost) return;
        const targetId = String(msg.targetUserId || '');
        const target = room.participants.get(targetId);
        if (target && !target.isHost) {
          room.participants.delete(targetId);
          room.savedPermissions.delete(targetId);
          if (target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(
              JSON.stringify({
                type: 'room:kicked',
                message: 'You were removed from the session by the host.',
              })
            );
            target.ws.close();
          }
          broadcastToRoom(room, {
            type: 'participants:updated',
            allGuestsLocked: room.allGuestsLocked,
            participants: serializeParticipants(room),
            eventNotice: `${target.name} was removed from the board`,
          });
        }
        return;
      }
    });

    ws.on('close', () => {
      if (currentRoomCode && currentUserId) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          const existing = room.participants.get(currentUserId);
          if (existing && existing.ws === ws) {
            room.participants.delete(currentUserId);
            broadcastToRoom(room, {
              type: 'participants:updated',
              allGuestsLocked: room.allGuestsLocked,
              participants: serializeParticipants(room),
            });
          }
        }
      }
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Collaborative Whiteboard Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
