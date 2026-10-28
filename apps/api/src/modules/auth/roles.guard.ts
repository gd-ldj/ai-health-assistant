import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtUser } from './jwt.strategy';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'user' | 'admin'>) => SetMetadata(ROLES_KEY, roles);

/**
 * 应用层第一道闸门。第二道在数据库（Supabase RLS）——
 * 即便有人绕过 Guard，RLS 也只放行自己的行。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user) throw new ForbiddenException('未认证');
    if (!required.includes(user.role)) throw new ForbiddenException('权限不足');
    return true;
  }
}

export const Auth = (...roles: Array<'user' | 'admin'>) =>
  applyDecorators(
    UseGuards(RolesGuard),
    roles.length ? Roles(...roles) : Roles('user', 'admin'),
  );
