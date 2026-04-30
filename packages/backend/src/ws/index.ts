import websocket from '@fastify/websocket';
import { type WsEvent, WsEventSchema } from '@nexus/shared';
import type { FastifyPluginAsync } from 'fastify';

import { loadEnv } from '../core/env.js';
import { verifyAccessToken } from '../routes/auth/service.js';

import { connectionStore, type WsConnection } from './connection-store.js';

/**
 * Plugin Fastify exposant `wss://.../ws?token=<jwt>`.
 *
 * - Authentifie via JWT en query param à l'open
 * - Heartbeat ping/pong
 * - Émet `presence:update` quand un user passe online/offline
 *
 * Cf. ADR-003 (protocole WS) et ADR-004 (auth).
 */
export const wsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  const env = loadEnv();
  const heartbeatMs = env.WS_HEARTBEAT_INTERVAL_MS;

  app.get('/ws', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      tryClose(socket, 4401, 'AUTH_NOT_AUTHENTICATED');
      return;
    }

    let userId: string;
    let groupIds: string[];
    try {
      const payload = verifyAccessToken(token);
      userId = payload.sub;
      groupIds = payload.groupIds;
    } catch {
      tryClose(socket, 4401, 'AUTH_TOKEN_INVALID');
      return;
    }

    const conn: WsConnection = { socket, userId, groupIds };
    const wasOffline = connectionStore.getByUser(userId).length === 0;
    connectionStore.add(conn);

    if (wasOffline) {
      broadcastPresence(userId, 'online', groupIds);
    }

    let isAlive = true;
    socket.on('pong', () => {
      isAlive = true;
    });
    const interval = setInterval(() => {
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, heartbeatMs);

    socket.on('close', () => {
      clearInterval(interval);
      const wentOffline = connectionStore.remove(conn);
      if (wentOffline) {
        broadcastPresence(userId, 'offline', groupIds);
      }
    });
  });
};

interface CloseableSocket {
  close(code?: number, reason?: string): void;
}

function tryClose(socket: CloseableSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // ignore
  }
}

/**
 * Broadcast un `presence:update` à tous les utilisateurs partageant
 * au moins un groupe avec celui qui a changé d'état.
 *
 * En J1 : on s'appuie sur le `groupIds` du payload JWT (snapshot au
 * moment du login). Acceptable pour le MVP — un user ajouté à un
 * nouveau groupe ne voit la présence des nouveaux membres qu'au
 * prochain refresh JWT (15 min max).
 */
function broadcastPresence(
  userId: string,
  status: 'online' | 'offline',
  groupIds: string[],
): void {
  const event: WsEvent = {
    type: 'presence:update',
    payload: { userId, status },
    timestamp: Date.now(),
  };
  const message = JSON.stringify(WsEventSchema.parse(event));

  const seen = new Set<string>();
  for (const otherUserId of connectionStore.onlineUserIds()) {
    if (otherUserId === userId) continue;
    if (seen.has(otherUserId)) continue;
    for (const conn of connectionStore.getByUser(otherUserId)) {
      if (conn.groupIds.some((g) => groupIds.includes(g))) {
        seen.add(otherUserId);
        try {
          conn.socket.send(message);
        } catch {
          // socket fermé entre temps, ignore
        }
        break;
      }
    }
  }
}
