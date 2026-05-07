/**
 * Hook React pour la connexion WebSocket nexus.
 *
 * Le serveur écoute sur `ws://.../ws?token=<accessToken>` (cf. ADR-003 +
 * ADR-015). Reconnexion exponentielle si déconnecté, et resubscribe tous les
 * handlers automatiquement.
 *
 * Les events WS sont validés contre WsEventSchema de @nexus/shared
 * (cf. ws-protocol.ts). Le handler reçoit un event typé et discriminé.
 */
import { useEffect, useRef, useState } from 'react';

import { WsEventSchema, type WsEvent } from '@nexus/shared';

import { getAccessToken } from './api';

export interface UseWsOptions {
  /** Si false, ne tente pas de connecter (utile avant que l'auth soit prête). */
  enabled?: boolean;
  onEvent: (event: WsEvent) => void;
}

export function useWs({ enabled = true, onEvent }: UseWsOptions) {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      const token = getAccessToken();
      if (!token) {
        // L'access token n'est pas encore prêt : on retentera après refresh.
        retryTimer = window.setTimeout(connect, 500);
        return;
      }
      // URL WS configurable :
      //  - Web build (Caddy `app.nexusapp.chat`) : `wss://<host>/ws` (relatif).
      //  - Tauri desktop : `wss://api.nexusapp.chat/ws` (absolu, injecté
      //    via `VITE_WS_BASE` au build time). Cf. ADR-031.
      const wsBase = (import.meta.env.VITE_WS_BASE as string | undefined)?.replace(/\/+$/, '');
      let url: string;
      if (wsBase) {
        url = `${wsBase}?token=${encodeURIComponent(token)}`;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        url = `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');

      ws.addEventListener('open', () => {
        attempts = 0;
        setStatus('open');
      });
      ws.addEventListener('message', (msg) => {
        try {
          const raw = JSON.parse(msg.data as string) as unknown;
          const parsed = WsEventSchema.safeParse(raw);
          if (parsed.success) {
            handlerRef.current(parsed.data);
          } else {
            console.warn('[ws] event invalide', parsed.error.issues);
          }
        } catch (err) {
          console.warn('[ws] message non-JSON', err);
        }
      });
      ws.addEventListener('close', () => {
        setStatus('closed');
        if (stopped) return;
        attempts += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
        retryTimer = window.setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled]);

  return { status };
}
