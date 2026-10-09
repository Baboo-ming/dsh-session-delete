/**
 * The seven-stage session-deletion pipeline.
 *
 * Requirement: "确认后依次执行：校验 ID → 运行保护 → 工作区挂账移除 →
 * 归档集合清理 → 磁盘日志删除 → 内存摘除 → 广播事件；所有阶段独立
 * try/catch 降级，不拖垮宿主" — every stage runs in its own try/catch, a
 * failing stage never aborts the remaining independent cleanup work, and no
 * exception may escape to the host.
 *
 * Two stages are gates rather than cleanup: `validate` and `running-guard`.
 * A gate that refuses aborts the pipeline before anything is mutated, because
 * deleting the wrong id (or deleting a session that is mid-turn) is not
 * recoverable by a later stage.
 */

/**
 * Stable stage keys, in execution order. The `label` is the user-facing
 * (Simplified Chinese) name shown in the confirm/progress UI.
 */
export const STAGES = Object.freeze([
  Object.freeze({ key: 'validate', label: '校验 ID', gate: true }),
  Object.freeze({ key: 'running-guard', label: '运行保护', gate: true }),
  Object.freeze({ key: 'workspace-ledger', label: '工作区挂账移除', gate: false }),
  Object.freeze({ key: 'archive-set', label: '归档集合清理', gate: false }),
  Object.freeze({ key: 'disk-logs', label: '磁盘日志删除', gate: false }),
  Object.freeze({ key: 'memory', label: '内存摘除', gate: false }),
  Object.freeze({ key: 'broadcast', label: '广播事件', gate: false }),
])

/** Stage keys whose failure means "the session still exists on disk". */
const DISK_CRITICAL = new Set(['disk-logs'])

/**
 * Normalise whatever a stage returned into a status.
 *
 * @param value a stage's return value.
 * @returns `{ status, detail, abort, reason, extra }`.
 */
function interpretStageResult(value) {
  if (value === undefined || value === null) return { status: 'ok' }
  if (typeof value !== 'object') return { status: 'ok', detail: String(value) }
  const status = typeof value.status === 'string' ? value.status : 'ok'
  return {
    status,
    detail: value.detail,
    abort: value.abort === true,
    reason: value.reason,
    extra: value.extra,
  }
}

/**
 * Run the pipeline.
 *
 * @param options
 * @param options.sessionId raw session id being deleted.
 * @param options.stages map of stage key → `(context) => result | Promise<result>`,
 *   where a result may be `{ status: 'ok'|'skipped', detail }`, or
 *   `{ abort: true, reason }` to veto deletion from a gate; throwing is
 *   equivalent to `{ status: 'failed' }` but never propagates.
 * @param options.context arbitrary context object handed to every stage
 *   (services, resolved cwd, `force`, logger, …). The runner adds
 *   `context.report` so late stages can read earlier outcomes.
 * @param options.logger optional `(message, meta) => void`.
 * @param options.clock optional `() => number` used for per-stage timings.
 * @returns a structured, always-resolvable report (never throws).
 */
export async function runDeletionPipeline(options) {
  const {
    sessionId,
    stages = {},
    context = {},
    logger,
    clock = () => Date.now(),
  } = options ?? {}

  const report = {
    sessionId,
    stageOrder: STAGES.map((stage) => stage.key),
    stages: [],
    deleted: false,
    partial: false,
    aborted: false,
    refused: false,
    warnings: [],
  }
  // `clock` is exposed to stages as well as used for timings: stage code that
  // stamps a record must not call `Date.now()` directly, or tests cannot pin it.
  const shared = { ...context, sessionId, report, logger, clock }

  for (const definition of STAGES) {
    const entry = {
      key: definition.key,
      label: definition.label,
      status: 'skipped',
      detail: undefined,
      error: undefined,
      ms: 0,
    }
    const stage = stages[definition.key]
    if (typeof stage !== 'function') {
      entry.detail = '阶段未装配（能力缺失，降级跳过）'
      report.stages.push(entry)
      if (definition.gate) {
        entry.status = 'skipped'
      }
      continue
    }

    const started = clock()
    try {
      const value = await stage(shared)
      const interpreted = interpretStageResult(value)
      entry.status = interpreted.status
      entry.detail = interpreted.detail
      if (interpreted.extra !== undefined) entry.extra = interpreted.extra
      if (interpreted.abort === true) {
        entry.status = 'blocked'
        entry.detail = interpreted.reason ?? interpreted.detail ?? '阶段拒绝继续'
        report.aborted = true
        if (definition.gate) report.refused = true
      }
    } catch (error) {
      entry.status = 'failed'
      entry.error = describeError(error)
      entry.detail = '阶段异常，已降级继续'
      report.warnings.push(`${definition.label}：${entry.error.message}`)
      if (logger) {
        try {
          logger(`[session-delete] stage ${definition.key} failed`, { error: entry.error })
        } catch {
          /* logging must never break the pipeline */
        }
      }
      if (definition.gate) {
        report.aborted = true
        report.refused = true
      }
    } finally {
      entry.ms = Math.max(0, clock() - started)
    }

    report.stages.push(entry)
    if (report.aborted) break
  }

  const byKey = new Map(report.stages.map((entry) => [entry.key, entry]))
  const diskStage = byKey.get('disk-logs')
  const ledgerStage = byKey.get('workspace-ledger')
  const diskGone = diskStage?.status === 'ok' || diskStage?.status === 'skipped'
  const ledgerClean = ledgerStage?.status === 'ok' || ledgerStage?.status === 'skipped'
  report.deleted = !report.aborted && diskGone && ledgerClean
  report.partial = !report.deleted && report.stages.some((entry) => entry.status === 'ok'
    && DISK_CRITICAL.has(entry.key) === false
    && entry.key !== 'validate'
    && entry.key !== 'running-guard')

  // A stage can fail without throwing (a returned `status: 'failed'`); it still
  // belongs in `warnings`, otherwise a degraded run would look clean to any
  // consumer that only reads `warnings`.
  for (const entry of report.stages) {
    if (entry.status !== 'failed' || entry.error !== undefined) continue
    report.warnings.push(`${entry.label}：${entry.detail ?? '阶段失败'}`)
  }

  // Surface what the disk stage could not remove (a locked file on Windows is the
  // usual cause) so the UI can name the leftovers instead of showing a bare code.
  report.leftoverDiskPaths = Array.isArray(shared.leftoverDiskPaths) ? [...shared.leftoverDiskPaths] : []

  return report
}

/**
 * Human-readable one-line summary of a report, for toasts and logs.
 *
 * @param report a `runDeletionPipeline` report.
 */
export function summarizeReport(report) {
  if (!report) return '空报告'
  const failed = report.stages.filter((entry) => entry.status === 'failed')
  // On an abort the base sentence already says that nothing was deleted, and
  // the only blocked stage is the gate that vetoed — listing it adds nothing.
  const blocked = report.aborted ? [] : report.stages.filter((entry) => entry.status === 'blocked')
  const base = report.deleted ? '会话已永久删除' : report.aborted ? '已中止：未删除任何数据' : '删除未完成'
  const parts = []
  if (failed.length > 0) parts.push(`降级：${failed.map((entry) => entry.label).join('、')}`)
  // A blocked stage deliberately did not do its job (e.g. the broadcast is
  // suppressed because the disk stage failed). Without this the summary of an
  // incomplete deletion never mentions that the sidebar row was kept on
  // purpose, which is exactly the state a human has to act on.
  if (blocked.length > 0) parts.push(`阻断：${blocked.map((entry) => entry.label).join('、')}`)
  if (parts.length === 0) return base
  return `${base}（${parts.join('；')}）`
}

/** Convert an unknown thrown value into a serialisable error record. */
export function describeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: error.code, stack: error.stack }
  }
  return { name: 'Error', message: String(error) }
}
