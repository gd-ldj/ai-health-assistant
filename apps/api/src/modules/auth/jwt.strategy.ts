import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RedisService } from '../../common/redis.service';

export interface JwtUser {
  sub: string;
  role: 'user' | 'admin';
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly redis: RedisService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: any): Promise<JwtUser> {
    // 登出后的 token 即便没过期也要拦掉
    if (await this.redis.isBlacklisted(payload.jti)) {
      throw new Error('token revoked');
    }
    return { sub: payload.sub, role: payload.role ?? 'user', jti: payload.jti };
  }
}
