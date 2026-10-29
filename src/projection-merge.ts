/**
 * 0.0.89：会话投影块合并——按 asOfSeq 取"更新的一侧"为基底，另一侧补缺（不覆盖）。
 * 背景（用户实测）：冷会话在 session.list 里可能带一个**陈旧**的投影块
 * （asOfSeq=2、sessionStats 全 0、无 title），而 session.history 的投影块是完整的
 * （含 title/用量/统计）。旧实现固定"现有值优先"（{...baseline, ...existing}），
 * 陈旧值会压住历史基线 → 打开会话也不显示统计行/红绿灯、标题也不刷新。
 * 规则：asOfSeq 大者胜；并列或双方都无 seq 时维持旧行为（现有值优先）。
 * 纯函数（不 import vscode），测试见 tests/projection-merge.spec.ts。
 */

export interface ProjectionBlock {
  asOfSeq?: number
  values?: Record<string, unknown>
}

export function mergeProjectionBlocks(existing: ProjectionBlock | undefined, baseline: ProjectionBlock): ProjectionBlock {
  const existingSeq = typeof existing?.asOfSeq === 'number' ? existing.asOfSeq : undefined
  const baselineSeq = typeof baseline.asOfSeq === 'number' ? baseline.asOfSeq : undefined
  const baselineWins = baselineSeq !== undefined && (existingSeq === undefined || baselineSeq > existingSeq)
  const values = baselineWins
    ? { ...(existing?.values ?? {}), ...(baseline.values ?? {}) }
    : { ...(baseline.values ?? {}), ...(existing?.values ?? {}) }
  const asOfSeq = existingSeq === undefined
    ? baselineSeq
    : (baselineSeq === undefined ? existingSeq : Math.max(existingSeq, baselineSeq))
  return { ...(asOfSeq === undefined ? {} : { asOfSeq }), values }
}
