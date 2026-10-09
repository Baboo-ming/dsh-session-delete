/**
 * The seven stage implementations, wired to the host runtime.
 *
 * `core/pipeline.js` owns ordering, gating and per-stage error isolation; this
 * module only answers "what does this stage do", and each answer is a thin
 * adapter over a service call that has a defined degradation.
 */
import { ledgerHasSession } from '../core/ledger.js'
import { STAGES, describeError } from '../core/pipeline.js'
import { isDeletableSessionId, readLedgerFile } from './runtime.js'

/** `1234567` → `1.2 MB`, for user-facing detail strings. */
function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let scaled = value / 1024
  let index = 0
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[index]}`
}

function failureDetail(label, failures) {
  const first = failures[0]
  // `removeSessionDirs` reports plain strings, service failures report Error
  // objects: accept both, otherwise the user sees "[object Object]".
  const message = typeof first?.error === 'string'
    ? first.error
    : first?.error?.message ?? first?.message ?? String(first)
  return `${label}：${failures.length} 项失败（首项：${message}）`
}

/**
 * Build the `stages` map consumed by `runDeletionPipeline`.
 *
 * @param runtime a `createRuntime()` result.
 */
export function createStages(runtime) {
  /** validate — gate: refuse ids we would not dare to turn into paths. */
  async function validate({ sessionId }) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return { abort: true, reason: '会话 ID 为空，已拒绝删除' }
    }
    if (!isDeletableSessionId(sessionId)) {
      return { abort: true, reason: `会话 ID 含非法字符，已拒绝删除：${sessionId}` }
    }
    const info = await runtime.inspect(sessionId)
    let known = info.known
    let source = info.knownSource
    if (!known) {
      const read = await readLedgerFile(runtime.paths.ledgerFile)
      if (read.ok && read.ledger && ledgerHasSession(read.ledger, sessionId)) {
        known = true
        source = 'ledger'
      }
    }
    if (!known) {
      return { abort: true, reason: '宿主持久化中没有该会话，可能已被删除' }
    }
    return {
      status: 'ok',
      detail: `已确认会话存在（来源：${source ?? '未知'}）`,
      extra: { live: info.live === true, cwd: info.cwd },
    }
  }

  /** running-guard — gate: never delete a session that is mid-turn. */
  async function runningGuard({ sessionId, force }) {
    if (runtime.liveSession(sessionId) === undefined) {
      return { status: 'ok', detail: '会话未在运行，无需保护' }
    }
    const probe = await runtime.activity(sessionId)
    if (probe.list.length === 0) {
      return {
        status: 'ok',
        detail: probe.supported ? '会话已就绪，无进行中的活动' : '无法探测活动（能力缺失），按就绪处理',
      }
    }
    if (force !== true) {
      return {
        abort: true,
        reason: `会话正在运行中（${probe.list.length} 项活动），已拒绝删除`,
      }
    }
    const stopped = await runtime.stopActivity(sessionId)
    return {
      status: stopped.status === 'ok' ? 'ok' : 'failed',
      detail: `强制删除：${stopped.detail}`,
      extra: { activity: probe.list },
    }
  }

  /** workspace-ledger — remove the session from every workspace record. */
  async function workspaceLedger({ sessionId, clock }) {
    const now = typeof clock === 'function' ? clock() : Date.now()
    const result = await runtime.removeFromWorkspaces(sessionId, now)
    if (result.unavailable === true && result.changed !== true) {
      if (result.missing === true) {
        return { status: 'skipped', detail: '宿主没有工作区挂账文件，无需清理' }
      }
      return {
        status: 'failed',
        detail: result.invalid
          ? `工作区挂账文件结构异常（${result.invalid}），未改动任何数据`
          : `工作区挂账不可用：${result.error?.message ?? '服务与文件均不可用'}`,
      }
    }
    if (Array.isArray(result.failures) && result.failures.length > 0) {
      return {
        status: 'failed',
        detail: failureDetail('工作区挂账移除', result.failures),
        extra: { touched: result.touched, via: result.via },
      }
    }
    if (result.changed !== true) {
      return { status: 'ok', detail: `该会话未挂账于任何工作区（${result.via}）`, extra: { via: result.via } }
    }
    const count = Array.isArray(result.touched) ? result.touched.length : 0
    return {
      status: 'ok',
      detail: `已从 ${count} 个工作区移除挂账（${result.via}）`,
      extra: { touched: result.touched, via: result.via },
    }
  }

  /** archive-set — drop the id from `archivedSessionIds` / `pinnedSessionIds`. */
  async function archiveSet({ sessionId, clock }) {
    const now = typeof clock === 'function' ? clock() : Date.now()
    const result = await runtime.removeFromGlobalSets(sessionId, now)
    if (result.unavailable === true && result.changed !== true) {
      if (result.missing === true) {
        return { status: 'skipped', detail: '宿主没有工作区挂账文件，没有归档集合可清理' }
      }
      return {
        status: 'failed',
        detail: result.invalid
          ? `工作区挂账文件结构异常（${result.invalid}），归档集合未清理`
          : `归档集合不可用：${result.error?.message ?? '服务与文件均不可用'}`,
      }
    }
    if (result.changed !== true) {
      return { status: 'skipped', detail: '会话既未归档也未置顶，无需清理' }
    }
    const parts = []
    if (result.archived) parts.push('归档集合')
    if (result.pinned) parts.push('置顶集合')
    return {
      status: 'ok',
      detail: `已清理${parts.join('与')}（${result.via}）`,
      extra: { via: result.via, archived: result.archived === true, pinned: result.pinned === true },
    }
  }

  /** disk-logs — delete session directories and the projection cache entry. */
  async function diskLogs(shared) {
    const { sessionId } = shared
    const targets = await runtime.diskTargets(sessionId)
    const paths = targets.dirs.map((dir) => dir.path).filter((dir) => typeof dir === 'string')
    const removal = await runtime.removeDisk(sessionId, paths)
    const failed = [
      ...(Array.isArray(removal.failed) ? removal.failed : []),
      ...(Array.isArray(removal.cache?.failed) ? removal.cache.failed : []),
    ]
    const removedCount = removal.removed?.length ?? 0
    const cacheCount = removal.cache?.removed?.length ?? 0
    // `removeSessionDirs` reports `{ dir, summary }` entries, not bare paths.
    const removedPaths = new Set(
      (Array.isArray(removal.removed) ? removal.removed : []).map((entry) => (
        typeof entry === 'string' ? entry : entry?.dir
      )).filter(Boolean),
    )
    const totalBytes = targets.dirs.reduce((sum, dir) => sum + (Number(dir.bytes) || 0), 0)
    // A session directory that is a link to a directory *not* named after the
    // session loses only its session artifacts; anything else in there stays and
    // is reported instead of being silently kept.
    const leftovers = (Array.isArray(removal.removed) ? removal.removed : [])
      .flatMap((entry) => (Array.isArray(entry?.leftover) ? entry.leftover : []))
    const extra = {
      removed: removal.removed ?? [],
      pruned: removal.pruned ?? [],
      cache: removal.cache?.removed ?? [],
      cacheVia: removal.cache?.via,
      scanned: targets.scanned,
      cwds: targets.cwds,
      bytes: totalBytes,
      ...(leftovers.length > 0 ? { leftover: leftovers } : {}),
    }

    // A live session still holds its JSONL writer open: the memory stage runs
    // next, releases the handle, and retries exactly these leftovers.
    shared.diskFailed = failed.length > 0
    if (failed.length > 0) {
      shared.leftoverDiskPaths = paths.filter((dir) => !removedPaths.has(dir))
      return { status: 'failed', detail: failureDetail('磁盘日志删除', failed), extra }
    }
    if (paths.length === 0) {
      return { status: 'ok', detail: '磁盘上没有该会话的日志目录', extra }
    }
    return {
      status: 'ok',
      detail: `已删除 ${removedCount} 个会话目录（${formatBytes(totalBytes)}）与 ${cacheCount} 个投影缓存文件`
        + (leftovers.length > 0 ? `；链接目标目录另有 ${leftovers.length} 个非会话文件未删除` : ''),
      extra,
    }
  }

  /** memory — drop the live store entry, then retry the locked disk paths. */
  async function memory(shared) {
    const { sessionId } = shared
    const detach = await runtime.detachFromMemory(sessionId)
    const leftovers = Array.isArray(shared.leftoverDiskPaths) ? shared.leftoverDiskPaths : []
    let retry
    if (leftovers.length > 0) {
      try {
        retry = await runtime.removeDisk(sessionId, leftovers)
        const retryRemoved = new Set(
          (Array.isArray(retry.removed) ? retry.removed : []).map((entry) => (
            typeof entry === 'string' ? entry : entry?.dir
          )).filter(Boolean),
        )
        if (retryRemoved.size > 0) {
          shared.leftoverDiskPaths = leftovers.filter((dir) => !retryRemoved.has(dir))
        }
        // nothing left on disk any more ⇒ the earlier failure is repaired, and
        // the broadcast stage may tell the client the row is gone
        if (shared.leftoverDiskPaths.length === 0) shared.diskFailed = false
      } catch (error) {
        retry = { error: describeError(error) }
      }
    }
    const retryNote = retry
      ? retry.error
        ? `；占用重试失败（${retry.error.message}）`
        : `；占用重试删除 ${retry.removed?.length ?? 0} 个目录`
      : ''
    // Disposing a live session writes a final projection snapshot, so the cache
    // entry that stage 5 removed can be back by now (observed live: it reappeared
    // 27s after a successful delete and kept the registry claiming `known`).
    let cacheSweep
    if (typeof runtime.sweepProjectionCache === 'function') {
      try {
        cacheSweep = await runtime.sweepProjectionCache(sessionId)
      } catch (error) {
        cacheSweep = {
          via: 'file',
          removed: [],
          failed: [{ path: 'projection-cache', error: describeError(error) }],
        }
      }
    }
    const cacheNote = cacheSweep === undefined
      ? ''
      : cacheSweep.removed.length > 0
        ? `；摘除后再次清理投影缓存 ${cacheSweep.removed.length} 项`
        : ''
    const extra = cacheSweep === undefined ? { retry } : { retry, cacheSweep }
    if (detach.status === 'skipped') {
      return { status: 'skipped', detail: `${detach.detail}${retryNote}${cacheNote}`, extra }
    }
    if (detach.status !== 'ok') {
      return { status: 'failed', detail: `${detach.detail}${retryNote}${cacheNote}`, extra }
    }
    return { status: 'ok', detail: `${detach.detail}${retryNote}${cacheNote}`, extra }
  }

  /**
   * broadcast — tell the client the row is gone.
   *
   * Only when the session really is gone: if the disk stage failed (typically a
   * file still locked on Windows) the logs survive, so hiding the row would
   * leave the UI claiming a deletion the disk never performed — and the session
   * would reappear after a restart. The stage then reports `blocked` instead,
   * and the dialog's failure detail tells the user what is left behind.
   */
  async function broadcast(shared) {
    const { sessionId } = shared
    if (shared.diskFailed === true) {
      return {
        status: 'blocked',
        detail: '磁盘日志仍在，跳过移除广播以免列表与磁盘不一致；请按报告中的残留路径重试',
      }
    }
    const result = await runtime.broadcastRemoved(sessionId)
    return { status: result.status, detail: result.detail }
  }

  const implementations = {
    validate,
    'running-guard': runningGuard,
    'workspace-ledger': workspaceLedger,
    'archive-set': archiveSet,
    'disk-logs': diskLogs,
    memory,
    broadcast,
  }

  // Fail loudly at wiring time if pipeline.js ever grows a stage we forgot.
  const missing = STAGES.map((stage) => stage.key).filter((key) => typeof implementations[key] !== 'function')
  if (missing.length > 0) throw new Error(`session-delete: 未装配的阶段 ${missing.join('、')}`)

  return implementations
}
