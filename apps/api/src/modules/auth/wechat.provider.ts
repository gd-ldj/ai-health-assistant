import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase.service';

export interface OAuthIdentity {
  provider: 'wechat' | 'apple' | 'google';
  unionId?: string;      // 跨应用唯一，优先用它做账号合并
  openId: string;
  nickname?: string;
  avatarUrl?: string;
}

/**
 * 登录方式做成可插拔：现在只有邮箱/手机号，微信资质齐了填 .env 打开即生效。
 * 以后加 Apple / Google 只需再实现一次这个接口并注册进 AuthService。
 */
export interface OAuthProvider {
  readonly name: string;
  readonly enabled: boolean;
  exchangeCode(code: string): Promise<OAuthIdentity>;
  resolveOrCreateUser(id: OAuthIdentity, supabase: SupabaseService): Promise<string>;
}

@Injectable()
export class WechatProvider implements OAuthProvider {
  private readonly logger = new Logger(WechatProvider.name);
  readonly name = 'wechat';
  readonly enabled = process.env.WECHAT_ENABLED === 'true';

  async exchangeCode(code: string): Promise<OAuthIdentity> {
    if (!this.enabled) throw new Error('wechat oauth disabled');

    // 开放平台网站应用（微信外扫码）：https://api.weixin.qq.com/sns/oauth2/access_token
    // 公众号网页授权（微信内打开）：scope=snsapi_userinfo
    // 小程序：code2session，unionid 需绑定开放平台
    const r = await fetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${process.env.WECHAT_APP_ID}` +
        `&secret=${process.env.WECHAT_APP_SECRET}&code=${code}&grant_type=authorization_code`,
    );
    const json = (await r.json()) as any;
    if (json.errcode) throw new Error(`wechat oauth failed: ${json.errmsg}`);

    const info = await (
      await fetch(
        `https://api.weixin.qq.com/sns/userinfo?access_token=${json.access_token}&openid=${json.openid}`,
      )
    ).json();

    return {
      provider: 'wechat',
      unionId: (json as any).unionid ?? (info as any).unionid,
      openId: json.openid,
      nickname: (info as any).nickname,
      avatarUrl: (info as any).headimgurl,
    };
  }

  async resolveOrCreateUser(id: OAuthIdentity, supabase: SupabaseService): Promise<string> {
    const key = id.unionId ?? id.openId;

    const { data: existing } = await supabase.admin
      .from('profiles')
      .select('id')
      .eq('wechat_unionid', key)
      .maybeSingle();
    if (existing) return existing.id;

    // 首次登录：建 Supabase Auth 用户（随机邮箱占位），profile 由触发器自动创建
    const { data, error } = await supabase.admin.auth.admin.createUser({
      email: `wx_${key}@wechat.local`,
      email_confirm: true,
      user_metadata: { nickname: id.nickname, avatar_url: id.avatarUrl, provider: 'wechat' },
    });
    if (error) throw new Error(error.message);

    await supabase.admin
      .from('profiles')
      .update({ wechat_unionid: key })
      .eq('id', data.user.id);

    return data.user.id;
  }
}
