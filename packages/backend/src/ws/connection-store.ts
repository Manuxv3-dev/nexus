import type { WebSocket } from '@fastify/websocket';

/**
 * Store local des connexions WS Nexus.
 *
 * Tient un mapping `userId → Set<WebSocket>` pour pouvoir router les
 * events à tous les sockets d'un utilisateur, et un mapping inverse
 * pour le cleanup à la déconnexion.
 *
 * En J1, le store est local au process. En J3+, on ajoutera un
 * canal Redis pub/sub pour le fan-out cross-process.
 */
export interface WsConnection {
  socket: WebSocket;
  userId: string;
  groupIds: string[];
}

class ConnectionStore {
  private byUser = new Map<string, Set<WsConnection>>();

  add(conn: WsConnection): void {
    let set = this.byUser.get(conn.userId);
    if (!set) {
      set = new Set();
      this.byUser.set(conn.userId, set);
    }
    set.add(conn);
  }

  remove(conn: WsConnection): boolean {
    const set = this.byUser.get(conn.userId);
    if (!set) return false;
    set.delete(conn);
    if (set.size === 0) {
      this.byUser.delete(conn.userId);
      return true; // user n'a plus aucune connexion → réellement offline
    }
    return false;
  }

  getByUser(userId: string): readonly WsConnection[] {
    return Array.from(this.byUser.get(userId) ?? []);
  }

  /** Liste tous les userIds connectés. */
  onlineUserIds(): string[] {
    return Array.from(this.byUser.keys());
  }

  /** Nombre total de sockets actifs. */
  size(): number {
    let total = 0;
    for (const set of this.byUser.values()) total += set.size;
    return total;
  }

  clear(): void {
    this.byUser.clear();
  }
}

export const connectionStore = new ConnectionStore();
