/**
 * `dsh-session-delete` — host-side plugin entry.
 *
 * Requirement (translated): inject a "delete session" item (danger styling)
 * into the sidebar session row's `...` menu, confirm with a second modal, then
 * run a seven-stage deletion pipeline (validate id → running guard → workspace
 * ledger removal → archive-set cleanup → disk log deletion → memory detach →
 * broadcast), refresh the sidebar afterwards, and let every stage fail
 * independently so the host survives.
 *
 * The client half lives in `lib/client.js`; this half owns the filesystem and
 * the host services and exposes them over plugin-owned HTTP routes
 * (`/session-delete/preview`, `/session-delete/delete`, and the workspace batch
 * routes `/session-delete/workspace/{preview,delete,status}`).
 */
import { randomUUID } from 'node:crypto'
import { describeError, runDeletionPipeline, summarizeReport } from './core/pipeline.js'
import { createHandler } from './host/http.js'
import { createRuntime } from './host/runtime.js'
import { createStages } from './host/stages.js'

export const name = 'dsh-session-delete'
export const version = '0.2.2'

/**
 * Finished workspace jobs are dropped after this idle time (and the map is
 * capped at `WORKSPACE_JOB_LIMIT`), so polling clients can always read their
 * snapshot without the host growing an unbounded job registry.
 */
const WORKSPACE_JOB_TTL_MS = 30 * 60 * 1000

/** Hard cap on retained workspace jobs; the oldest finished ones go first. */
const WORKSPACE_JOB_LIMIT = 50

/**
 * No hard service dependency: `sessions`, `workspaceRegistry` and `webServer`
 * are all looked up lazily and degrade to `skipped` stages when absent. The
 * plugin must never stop the host from booting.
 */
export const inject = []

/** Logger adapter: cordis loggers, `console` and a no-op all work. */
function createLogger(ctx) {
  const write = (level, message, meta) => {
    try {
      const text = meta === undefined
        ? `[session-delete] ${message}`
        : `[session-delete] ${message} ${safeJson(meta)}`
      const logger = ctx?.logger
      if (logger && typeof logger[level] === 'function') {
        logger[level](text)
        return
      }
      if (level === 'error' || level === 'warn') console.warn(text)
    } catch {
      /* logging may never break a stage */
    }
  }
  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Per-boot request token.
 *
 * The host web server installs no admission control of its own (`/api` relies on
 * `connection.admit`), and a cross-site `sendBeacon`/form POST carries no origin
 * in some clients, so the plugin adds its own bearer value. It is handed out by
 * `GET /session-delete/health`, which a cross-site page cannot read because the
 * server emits no CORS header — blind requests therefore cannot learn it.
 */
function createToken() {
  try {
    return randomUUID()
  } catch {
    return `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

/**
 * Wire runtime + stages + HTTP handler onto a context.
 *
 * Exported separately from `apply` so tests can drive the host logic with a
 * stub context and without a web server.
 *
 * @returns `{ runtime, stages, deleteSession, handler, logger, token,
 *   previewWorkspace, startWorkspaceDelete, workspaceJob }`.
 */
export function createSessionDeleter(ctx, rawConfig = {}) {
  const config = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const logger = createLogger(ctx)
  const log = (message, meta) => logger.warn(message, meta)
  const runtime = createRuntime(ctx, config, log)
  const stages = createStages(runtime)
  // `requireToken: false` opts out (scripted/local-only setups); the browser half
  // always fetches `/health` first, so the default stays on.
  const token = config.requireToken === false ? null : createToken()

  /**
   * Run the full pipeline for one session. Never throws: the report carries
   * per-stage outcomes (including a refusal).
   */
  async function deleteSession(sessionId, options = {}) {
    const force = options.force === true && config.allowForce !== false
    let report
    try {
      report = await runDeletionPipeline({
        sessionId,
        stages,
        context: { force, runtime, services: { ctx } },
        logger: log,
        clock: options.clock,
      })
    } catch (error) {
      // runDeletionPipeline is documented never to throw; this is the last net
      // before an exception could reach the HTTP layer.
      const described = describeError(error)
      report = {
        sessionId,
        stageOrder: [],
        stages: [],
        deleted: false,
        partial: false,
        aborted: true,
        refused: true,
        warnings: [`管线异常：${described.message}`],
      }
    }
    logger.info(`delete ${sessionId}: ${summarizeReport(report)}`)
    return report
  }

  /**
   * Workspace batch-delete jobs, keyed by job id. In-memory only: a job lives
   * for this boot, and the client polls it via `/session-delete/workspace/status`.
   */
  const jobs = new Map()

  /** Drop finished jobs past their TTL and enforce the retention cap. */
  function pruneWorkspaceJobs(now = Date.now()) {
    for (const [jobId, job] of jobs) {
      if (job.state === 'running') continue
      const stamp = Number.isFinite(job.finishedAt) ? job.finishedAt : job.startedAt
      if (now - stamp > WORKSPACE_JOB_TTL_MS) jobs.delete(jobId)
    }
    while (jobs.size > WORKSPACE_JOB_LIMIT) {
      let oldestId
      let oldestStamp = Infinity
      for (const [jobId, job] of jobs) {
        if (job.state === 'running') continue
        const stamp = Number.isFinite(job.finishedAt) ? job.finishedAt : job.startedAt
        if (stamp < oldestStamp) {
          oldestStamp = stamp
          oldestId = jobId
        }
      }
      // Every retained job is still running: the cap cannot be enforced yet.
      if (oldestId === undefined) break
      jobs.delete(oldestId)
    }
  }

  /** Serialisable copy of a job, so a status poll can never mutate it. */
  function jobSnapshot(job) {
    return {
      jobId: job.jobId,
      workspaceId: job.workspaceId,
      state: job.state,
      total: job.total,
      completed: job.completed,
      deleted: job.deleted,
      failed: job.failed.map((entry) => ({ ...entry })),
      current: job.current,
      error: job.error,
      force: job.force,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  }

  /**
   * Start deleting every session of one workspace, in the background.
   *
   * The HTTP route answers with the job id immediately and the client polls
   * `/workspace/status`; sessions are deleted sequentially because two parallel
   * ledger edits on the same file would contend. Never throws: a refused
   * preview comes back as `{ jobId: null, error }`.
   */
  async function startWorkspaceDelete(workspaceId, options = {}) {
    pruneWorkspaceJobs()
    const force = options.force === true
    let preview = options.preview
    try {
      if (preview === undefined || preview === null) preview = await runtime.previewWorkspace(workspaceId)
    } catch (error) {
      preview = { valid: false, error: describeError(error).message, sessions: [], count: 0 }
    }
    if (!preview || preview.valid !== true) {
      return { jobId: null, workspaceId, total: 0, error: preview?.error ?? '工作区不存在（可能已删除）' }
    }
    const ids = (Array.isArray(preview.sessions) ? preview.sessions : [])
      .map((session) => session?.sessionId)
      .filter((id) => typeof id === 'string' && id.length > 0)
    const job = {
      jobId: randomUUID(),
      workspaceId,
      state: 'running',
      total: ids.length,
      completed: 0,
      deleted: 0,
      failed: [],
      current: null,
      error: null,
      force,
      startedAt: Date.now(),
      finishedAt: undefined,
    }
    jobs.set(job.jobId, job)

    // Deliberately not awaited: the caller only needs the job id, and every
    // failure is captured on the job snapshot instead of escaping as a throw.
    void (async () => {
      try {
        for (const id of ids) {
          job.current = id
          try {
            const report = await deleteSession(id, { force })
            if (report?.deleted === true) {
              job.deleted += 1
            } else {
              job.failed.push({
                sessionId: id,
                refused: report?.refused === true,
                message: summarizeReport(report),
              })
            }
          } catch (error) {
            job.failed.push({ sessionId: id, refused: false, message: describeError(error).message })
          }
          job.completed += 1
        }
        job.state = job.failed.length === 0 ? 'done' : job.deleted > 0 ? 'partial' : 'failed'
      } catch (error) {
        job.state = 'failed'
        job.error = describeError(error).message
      } finally {
        job.current = null
        job.finishedAt = Date.now()
      }
    })()

    return { jobId: job.jobId, workspaceId, total: ids.length, state: job.state }
  }

  /**
   * Read one workspace job snapshot.
   *
   * @param jobId id returned by `startWorkspaceDelete`.
   * @returns the snapshot, or `undefined` when unknown/expired.
   */
  async function workspaceJob(jobId) {
    pruneWorkspaceJobs()
    if (typeof jobId !== 'string' || jobId.length === 0) return undefined
    const job = jobs.get(jobId)
    return job === undefined ? undefined : jobSnapshot(job)
  }

  /** Preview one workspace's sessions (workspace batch delete). */
  const previewWorkspace = (workspaceId) => runtime.previewWorkspace(workspaceId)

  const handler = createHandler({
    runtime,
    deleteSession,
    log,
    version,
    token,
    previewWorkspace,
    startWorkspaceDelete,
    workspaceJob,
  })

  return {
    runtime,
    stages,
    deleteSession,
    handler,
    logger,
    config,
    token,
    previewWorkspace,
    startWorkspaceDelete,
    workspaceJob,
  }
}

/**
 * Cordis entry point.
 *
 * @param ctx plugin context.
 * @param rawConfig patch `config` (see `cordis.patch.yml`) — supported keys:
 *   `dshHome`, `sessionsRoot`, `storagesRoot`, `ledgerFile`, `allowForce`,
 *   `requireToken` (default `true`; `false` accepts POSTs without the per-boot
 *   request token, for scripted or local-only setups).
 */
export function apply(ctx, rawConfig = {}) {
  const deleter = createSessionDeleter(ctx, rawConfig)
  const { runtime, handler, logger } = deleter

  // Route registration only when a web server is actually present.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: '/session-delete', handler }),
      'session-delete: http api',
    )
    logger.info(
      `HTTP API mounted at /session-delete (home=${runtime.paths.home}, token=${deleter.token ? 'required' : 'off'})`,
    )
  })

  logger.info(
    `ready — sessionsRoot=${runtime.paths.sessionsRoot} ledger=${runtime.paths.ledgerFile}`,
  )

  return deleter
}

export { createHandler } from './host/http.js'
export { createRuntime, isDeletableSessionId, isDeletableWorkspaceId, resolveDshHome, resolvePaths } from './host/runtime.js'
export { createStages } from './host/stages.js'
export { STAGES, runDeletionPipeline, summarizeReport } from './core/pipeline.js'
