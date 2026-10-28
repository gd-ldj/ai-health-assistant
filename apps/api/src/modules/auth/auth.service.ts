import 'reflect-metadata';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../common/supabase.service';
import { RedisService } from '../../common/redis.service';
import { WechatProvider } from './wechat.provider';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * 认证分两层：
 *  1. 身份：交给 Supabase Auth（邮箱/手机/未来微信），专业的事交给专业的
 *  2. 授权：我们自己签发 JWT，payload 里带 role，供 RolesGuard 与 RLS 使用
 * 这样换身份源（比如加微信登录）不影响授权体系。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly wechat: WechatProvider,
  ) {}

  async signUp(email: string, password: string) {
    const { data, error } = await this.supabase.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new UnauthorizedException(error.message);
    return this.issue(data.user.id, 'user');
  }

  async signInWithPassword(email: string, password: string): Promise<TokenPair> {
    const anon = this.supabase.forUser('');
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new UnauthorizedException(error?.message ?? '登录失败');

    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('role, status')
      .eq('id', data.user.id)
      .single();

    if (profile?.status === 'banned') throw new UnauthorizedException('账号已被禁用');
    return this.issue(data.user.id, profile?.role ?? 'user');
  }

  /** 微信登录：资质未齐时直接返回未启用，不会中断其他登录方式 */
  async signInWithWechat(code: string): Promise<TokenPair> {
    if (!this.wechat.enabled) throw new UnauthorizedException('微信登录未启用');
    const identity = await this.wechat.exchangeCode(code);
    const userId = await this.wechat.resolveOrCreateUser(identity, this.supabase);
    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();
    return this.issue(userId, profile?.role ?? 'user');
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = this.jwt.verify<{ sub: string; jti: string }>(refreshToken);
    if (await this.redis.isBlacklisted(payload.jti)) throw new UnauthorizedException('凭证已失效');
    await this.redis.blacklist(payload.jti, 0);
    const { data: profile } = await this.supabase.admin
      .from('profiles')
      .select('role')
      .eq('id', payload.sub)
      .single();
    return this.issue(payload.sub, profile?.role ?? 'user');
  }

  async logout(jti: string, ttlSec: number) {
    await this.redis.blacklist(jti, ttlSec);
  }

  private async issue(sub: string, role: string): Promise<TokenPair> {
    const jti = randomUUID();
    const accessToken = this.jwt.sign(
      { sub, role, jti, typ: 'access' },
      { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    );
    const refreshToken = this.jwt.sign(
      { sub, jti, typ: 'refresh' },
      { expiresIn: process.env.JWT_REFRESH_TTL ?? '30d' },
    );
    const expiresIn = 900;
    return { accessToken, refreshToken, expiresIn };
  }
}
