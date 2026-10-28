'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr('');
    setLoading(true);
    try {
      const res = await api<{ accessToken: string }>(
        mode === 'login' ? '/auth/login' : '/auth/signup',
        { method: 'POST', body: JSON.stringify({ email, password }) },
      );
      tokenStore.set(res.accessToken);
      router.replace('/');
    } catch (e: any) {
      setErr(e.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ justifyContent: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI 健康助手</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 0 }}>
        {mode === 'login' ? '登录后继续' : '创建账号'}
      </p>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="邮箱"
        style={inputStyle}
        inputMode="email"
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="密码（至少 8 位）"
        type="password"
        style={inputStyle}
      />

      {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}

      <button onClick={submit} disabled={loading} style={btnStyle}>
        {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
      </button>

      <button
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        style={{ ...btnStyle, background: 'transparent', color: 'var(--brand-strong)', border: '1px solid var(--border)' }}
      >
        {mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录'}
      </button>

      <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
        登录即表示同意：本服务仅提供健康信息参考，不构成医疗建议。
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 15,
  marginBottom: 10,
  background: 'var(--surface)',
};

const btnStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: 0,
  borderRadius: 12,
  background: 'var(--brand-strong)',
  color: '#fff',
  fontSize: 15,
  marginBottom: 10,
  cursor: 'pointer',
};
