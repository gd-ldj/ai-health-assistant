import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * 所有模型调用都走 OpenAI 兼容协议：
 * 换供应商只需改 .env 的 baseURL / key / model，业务代码零改动。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly chatClient: OpenAI;
  private readonly embedClient: OpenAI;
  private readonly model: string;
  private readonly embedModel: string;

  constructor(cfg: ConfigService) {
    this.chatClient = new OpenAI({
      apiKey: cfg.get<string>('LLM_API_KEY')!,
      baseURL: cfg.get<string>('LLM_BASE_URL')!,
    });
    this.embedClient = new OpenAI({
      apiKey: cfg.get<string>('EMBEDDING_API_KEY')!,
      baseURL: cfg.get<string>('EMBEDDING_BASE_URL')!,
    });
    this.model = cfg.get<string>('LLM_MODEL') ?? 'deepseek-chat';
    this.embedModel = cfg.get<string>('EMBEDDING_MODEL') ?? 'BAAI/bge-m3';
  }

  /** 流式对话，逐 chunk 回调给 SSE */
  async *streamChat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<string> {
    const stream = await this.chatClient.chat.completions.create(
      {
        model: this.model,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 4096,
      },
      { signal: opts.signal },
    );

    for await (const part of stream) {
      const delta = part.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** 带工具调用的非流式一轮，用于 Agent 决策 */
  async chatWithTools(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
    const res = await this.chatClient.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.1,
    });
    return res.choices[0]?.message!;
  }

  async chat(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<string> {
    const res = await this.chatClient.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.2,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.embedClient.embeddings.create({ model: this.embedModel, input: texts });
    return res.data.map((d) => d.embedding);
  }

  async embedOne(text: string): Promise<number[]> {
    return (await this.embed([text]))[0];
  }
}
