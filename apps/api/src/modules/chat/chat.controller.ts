import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { IsString } from 'class-validator';
import { ChatService } from './chat.service';
import { SupabaseService } from '../../common/supabase.service';
import { RedisService } from '../../common/redis.service';
import { Auth } from '../auth/roles.guard';

class SendDto {
  @IsString() sessionId!: string;
  @IsString() question!: string;
}

/**
 * 流式对话。
 * 浏览器原生 EventSource 不支持自定义 Header，所以 token 走 query；
 * 前端若用 fetch + ReadableStream 则带 Authorization 头，两条路都通。
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Sse('stream')
  sse(
    @Query('sessionId') sessionId: string,
    @Query('question') question: string,
    @Query('token') token?: string,
    @Req() req?: any,
  ): Observable<{ data: unknown }> {
    const bearer = req?.headers?.authorization?.replace('Bearer ', '');
    const raw = bearer || token;
    if (!raw) throw new UnauthorizedException('缺少凭证');

    const payload = this.jwt.verify<{ sub: string; jti: string }>(raw);

    return new Observable((subscriber) => {
      const ac = new AbortController();
      (async () => {
        if (await this.redis.isBlacklisted(payload.jti)) {
          subscriber.next({ data: { type: 'error', message: '凭证已失效' } });
          subscriber.complete();
          return;
        }
        try {
          for await (const ev of this.chat.stream(payload.sub, sessionId, question, ac.signal)) {
            subscriber.next({ data: ev });
          }
        } catch (e: any) {
          subscriber.next({ data: { type: 'error', message: e.message ?? '生成失败' } });
        } finally {
          subscriber.complete();
        }
      })();

      return () => ac.abort(); // 前端断开即中止模型调用，省 token
    });
  }

  @Get('sessions')
  @Auth()
  async sessions(@Req() req: any) {
    const { data } = await this.supabase.admin
      .from('chat_sessions')
      .select('id, title, updated_at')
      .eq('user_id', req.user.sub)
      .order('updated_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }

  @Post('sessions')
  @Auth()
  async createSession(@Req() req: any, @Body('title') title?: string) {
    const { data } = await this.supabase.admin
      .from('chat_sessions')
      .insert({ user_id: req.user.sub, title: title ?? '新对话' })
      .select()
      .single();
    return data;
  }

  @Get('sessions/:id/messages')
  @Auth()
  async messages(@Req() req: any, @Param('id') id: string) {
    const { data } = await this.supabase.admin
      .from('chat_messages')
      .select('id, role, content, citations, created_at')
      .eq('session_id', id)
      .eq('user_id', req.user.sub)
      .order('id', { ascending: true })
      .limit(200);
    return data ?? [];
  }

  @Delete('sessions/:id')
  @Auth()
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.supabase.admin
      .from('chat_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.sub);
    return { ok: true };
  }
}
