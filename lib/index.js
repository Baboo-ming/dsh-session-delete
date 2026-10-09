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
 * the host services and exposes them over a plugin-owned HTTP route
 * (`POST /session-delete/delete`, `POST /session-delete/preview`).
 */
import { randomUUID } from 'node:crypto'
import { describeError, runDeletionPipeline, summarizeReport } from './core/pipeline.js'
import { createHandler } from './host/http.js'
import { createRuntime } from './host/runtime.js'
import { createStages } from './host/stages.js'

export const name = 'dsh-session-delete'
export const version = '0.1.1'

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
 * @returns `{ runtime, stages, deleteSession, handler, logger, token }`.
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

  const handler = createHandler({ runtime, deleteSession, log, version, token })

  return { runtime, stages, deleteSession, handler, logger, config, token }
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
export { createRuntime, isDeletableSessionId, resolveDshHome, resolvePaths } from './host/runtime.js'
export { createStages } from './host/stages.js'
export { STAGES, runDeletionPipeline, summarizeReport } from './core/pipeline.js'
