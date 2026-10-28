'use client';

const TOKEN_KEY = 'aha_token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `请求失败 ${res.status}`);
  return res.json();
}

export interface StreamHandlers {
  onStatus?: (stage: string) => void;
  onTool?: (name: string, label: string) => void;
  onCitations?: (items: Citation[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (messageId: number) => void;
  onError?: (msg: string) => void;
}

export interface Citation {
  chunkId: number;
  docTitle: string;
  sourceUrl: string | null;
  content: string;
  score: number;
}

/**
 * 用 fetch + ReadableStream 消费 SSE（而非原生 EventSource），
 * 这样可以带 Authorization 头，也便于 AbortController 中断。
 */
export async function streamChat(
  sessionId: string,
  question: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const token = tokenStore.get();
  const url = `/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}&question=${encodeURIComponent(question)}`;

  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!res.body) throw new Error('服务端未返回流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        switch (ev.type) {
          case 'status':    handlers.onStatus?.(ev.stage); break;
          case 'tool':      handlers.onTool?.(ev.name, ev.label); break;
          case 'citations': handlers.onCitations?.(ev.items); break;
          case 'delta':     handlers.onDelta?.(ev.text); break;
          case 'done':      handlers.onDone?.(ev.messageId); break;
          case 'error':     handlers.onError?.(ev.message); break;
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
}
