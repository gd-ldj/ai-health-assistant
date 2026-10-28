import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { SupabaseService } from '../../common/supabase.service';
import { LlmService } from '../../common/llm.service';
import { RedisService } from '../../common/redis.service';
import { RagService, RetrievedChunk } from '../rag/rag.service';
import { HealthService } from '../health/health.service';

export type SseEvent =
  | { type: 'status'; stage: 'guard' | 'retrieve' | 'tool' | 'generate' }
  | { type: 'tool'; name: string; label: string; result: unknown }
  | { type: 'citations'; items: RetrievedChunk[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number; latencyMs: number }
  | { type: 'error'; message: string };

const MAX_TOOL_ROUNDS = 3;

/**
 * 对话编排：危险信号拦截 → Agent 工具调用（查档案/查指标/查知识库）
 * → RAG 检索 → 流式生成 → 落库并附引用。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly redis: RedisService,
    private readonly rag: RagService,
    private readonly health: HealthService,
  ) {}

  /** 暴露给模型的工具。只允许只读，且结果经过摘要脱敏 */
  private get tools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_health_profile',
          description: '查询用户本人的健康档案摘要（年龄、性别、身高体重、慢性病、过敏、用药）',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_recent_metrics',
          description: '查询用户本人近期的健康指标记录（血压、血糖、心率、体重、睡眠、步数等）',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['blood_pressure', 'blood_glucose', 'heart_rate', 'weight', 'steps', 'sleep'],
              },
              days: { type: 'number', description: '最近天数，默认 30' },
            },
            additionalProperties: false,
          },
        },
      },
    ];
  }

  private async runTool(name: string, args: any, userId: string) {
    switch (name) {
      case 'get_health_profile':
        return { label: '正在读取你的健康档案', data: await this.health.summarize(userId) };
      case 'get_recent_metrics':
        return {
          label: `正在查询最近 ${args.days ?? 30} 天的指标`,
          data: await this.health.listMetrics(userId, args.type, args.days ?? 30),
        };
      default:
        return { label: name, data: null };
    }
  }

  async *stream(
    userId: string,
    sessionId: string,
    question: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> {
    const started = Date.now();

    // 0. 危险信号拦截：这是硬规则，不走模型
    yield { type: 'status', stage: 'guard' };
    const red = this.rag.detectRedFlag(question);
    if (red) {
      const text =
        `你提到了「${red}」，这属于需要立即处理的危险信号。\n\n` +
        `**请立刻就医或拨打 120**，不要等待线上回复。\n\n` +
        `*本回答仅供参考，不构成医疗建议。*`;
      yield { type: 'delta', text };
      const id = await this.persist(sessionId, userId, 'assistant', text, null, null, Date.now() - started);
      yield { type: 'done', messageId: id, latencyMs: Date.now() - started };
      return;
    }

    // 1. 落库用户提问
    await this.persist(sessionId, userId, 'user', question, null, null, 0);

    // 2. RAG 检索
    yield { type: 'status', stage: 'retrieve' };
    const chunks = await this.rag.retrieve(question);
    if (chunks.length) yield { type: 'citations', items: chunks };

    // 3. Agent 工具调用（最多 3 轮）
    const profile = await this.health.summarize(userId);
    const history = await this.loadHistory(sessionId, 8);

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.rag.buildMessages(question, chunks, profile)[0].content },
      ...history,
      { role: 'user', content: question },
    ];

    const toolTrace: any[] = [];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      yield { type: 'status', stage: 'tool' };
      const decision = await this.llm.chatWithTools(messages, this.tools);
      if (!decision.tool_calls?.length) break;

      messages.push(decision);
      for (const call of decision.tool_calls) {
        const args = JSON.parse(call.function.arguments || '{}');
        const { label, data } = await this.runTool(call.function.name, args, userId);
        yield { type: 'tool', name: call.function.name, label, result: data };
        toolTrace.push({ name: call.function.name, result: data });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof data === 'string' ? data : JSON.stringify(data).slice(0, 4000),
        });
      }
    }

    // 4. 流式生成
    yield { type: 'status', stage: 'generate' };
    let full = '';
    for await (const delta of this.llm.streamChat(messages, { signal })) {
      full += delta;
      yield { type: 'delta', text: delta };
    }

    const messageId = await this.persist(
      sessionId,
      userId,
      'assistant',
      full,
      chunks,
      toolTrace,
      Date.now() - started,
    );
    yield { type: 'done', messageId, latencyMs: Date.now() - started };
  }

  private async loadHistory(sessionId: string, n: number) {
    const { data } = await this.supabase.admin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('id', { ascending: false })
      .limit(n);
    return (data ?? [])
      .reverse()
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content ?? '' })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  }

  private async persist(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant',
    content: string,
    citations: RetrievedChunk[] | null,
    toolCalls: unknown,
    latencyMs: number,
  ): Promise<number> {
    const { data, error } = await this.supabase.admin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: userId,
        role,
        content,
        citations,
        tool_calls: toolCalls,
        latency_ms: latencyMs,
      })
      .select('id')
      .single();
    if (error) {
      this.logger.error(`消息落库失败: ${error.message}`);
      return -1;
    }
    return data.id;
  }
}
