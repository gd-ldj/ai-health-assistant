'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, streamChat, tokenStore, type Citation } from '@/lib/api';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  alert?: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  guard: '安全检查中…',
  retrieve: '正在检索健康知识库…',
  tool: '正在查询你的健康数据…',
  generate: '正在生成回答…',
};

export default function ChatPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [busy, setBusy] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace('/login');
      return;
    }
    (async () => {
      const s = await api<{ id: string }>('/chat/sessions', { method: 'POST', body: JSON.stringify({}) });
      setSessionId(s.id);
    })();
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, status]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || !sessionId || busy) return;

    setInput('');
    setBusy(true);
    setCitations([]);
    setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: q }]);

    const botId = `b-${Date.now()}`;
    setMsgs((m) => [...m, { id: botId, role: 'assistant', content: '' }]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamChat(
        sessionId,
        q,
        {
          onStatus: (s) => setStatus(STATUS_TEXT[s] ?? s),
          onCitations: (items) => setCitations(items),
          onDelta: (text) =>
            setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, content: x.content + text } : x))),
          onError: (msg) =>
            setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, content: `生成失败：${msg}` } : x))),
        },
        ac.signal,
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, content: `网络异常：${e.message}` } : x)));
      }
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }, [input, sessionId, busy]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>AI 健康助手</h1>
          <div className="sub">基于权威健康知识库 · 仅供参考</div>
        </div>
        <button
          onClick={() => { tokenStore.clear(); router.replace('/login'); }}
          style={{ border: 0, background: 'transparent', color: 'var(--text-dim)', fontSize: 13 }}
        >
          退出
        </button>
      </header>

      <div className="messages">
        {msgs.length === 0 && (
          <div className="bubble bot">
            你好，我可以基于权威健康知识回答你的问题。
            <br />
            试试问我：「成年人每天需要睡多久？」
            <br />
            <br />
            注意：我不能做诊断，如有不适请及时就医。
          </div>
        )}

        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role === 'user' ? 'user' : 'bot'} ${m.alert ? 'alert' : ''}`}>
            {m.content}
            {m.role === 'assistant' && citations.length > 0 && m.content && (
              <div className="citations">
                参考来源：
                <ol>
                  {citations.map((c) => (
                    <li key={c.chunkId}>
                      《{c.docTitle}》
                      {c.sourceUrl && (
                        <>
                          {' · '}
                          <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                            原文
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ))}

        {status && <div className="status">{status}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="描述你的健康问题…"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          发送
        </button>
      </div>

      <div className="disclaimer">本服务不构成医疗建议，不能替代执业医师诊断</div>
    </div>
  );
}
