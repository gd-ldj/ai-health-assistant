import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase.service';

/**
 * 健康档案 CRUD。同时作为 Agent 的工具实现层——
 * 工具函数只调用这里的只读方法，绝不开放写权限给模型。
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  constructor(private readonly supabase: SupabaseService) {}

  async getProfile(userId: string) {
    const { data } = await this.supabase.admin
      .from('health_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }

  async upsertProfile(userId: string, patch: Record<string, unknown>) {
    const { data, error } = await this.supabase.admin
      .from('health_profiles')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listMetrics(userId: string, type?: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    let q = this.supabase.admin
      .from('health_metrics')
      .select('type, value, measured_at, note')
      .eq('user_id', userId)
      .gte('measured_at', since)
      .order('measured_at', { ascending: false })
      .limit(500);
    if (type) q = q.eq('type', type);

    const { data } = await q;
    return data ?? [];
  }

  async addMetric(userId: string, input: { type: string; value: any; measuredAt?: string; note?: string }) {
    const { data, error } = await this.supabase.admin
      .from('health_metrics')
      .insert({
        user_id: userId,
        type: input.type,
        value: input.value,
        measured_at: input.measuredAt ?? new Date().toISOString(),
        note: input.note,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** 给 Agent 用的一句话摘要：只保留模型需要的事实，不暴露原始敏感字段 */
  async summarize(userId: string): Promise<string> {
    const p = await this.getProfile(userId);
    if (!p) return '（用户尚未填写健康档案）';
    const age = p.birth_date
      ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31_557_600_000)
      : null;
    const bits = [
      age !== null ? `${age}岁` : null,
      p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : null,
      p.height_cm ? `身高${p.height_cm}cm` : null,
      p.weight_kg ? `体重${p.weight_kg}kg` : null,
      p.chronic_conditions?.length ? `慢性病：${p.chronic_conditions.join('、')}` : null,
      p.allergies?.length ? `过敏：${p.allergies.join('、')}` : null,
      p.medications?.length ? `用药：${p.medications.join('、')}` : null,
    ].filter(Boolean);
    return bits.join('，') || '（档案信息为空）';
  }
}
