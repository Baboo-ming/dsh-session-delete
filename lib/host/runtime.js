/**
 * Host-side runtime adapters for `dsh-session-delete`.
 *
 * Everything in here is written against the *observed* DSH 0.2.0-rc.2 service
 * surface (extracted from the shipped asar into `.ref/`), never against a
 * guessed API:
 *
 * - `sessions`           — `.ref/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.js`
 *                          (`get`, `liveEntryFor`, `detachEntered`, `flush`)
 * - `workspaceRegistry`  — `.ref/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/types/index.js`
 *                          (`requireTable`, `requireState`, `setState`, `enqueueOperation`,
 *                           `readSessionHeader`, `stopSessionActivity`, `sessionKnown`)
 * - storage domain table — `.ref/dsh/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js`
 *                          (`get`, `keys`, `update`, `delete`; global handle is `get`/`set`)
 * - `webServer`          — route registration, see `http.js`
 *
 * Every adapter degrades: an unavailable service yields `{ status: 'skipped' }`
 * rather than an exception, matching the requirement that no single stage may
 * drag the host down.
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'

import { describeError } from '../core/pipeline.js'
import {
  removeSessionFromGlobalSets,
  removeSessionFromWorkspaces,
  validateLedger,
  workspacesForSession,
} from '../core/ledger.js'
import {
  describeDir,
  findSessionDirs,
  projectionCacheCandidates,
  removeProjectionCache,
  removeSessionDirs,
} from '../core/scan.js'

/** Conservative id shape: DSH ids are `session-<uuid>`, sub-agents use bare uuids. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/

/** True for ids we are willing to turn into filesystem paths. */
export function isDeletableSessionId(value) {
  if (typeof value !== 'string') return false
  if (value === '.' || value === '..') return false
  return SESSION_ID_PATTERN.test(value)
}

/**
 * Normalise a ledger timestamp to the ISO string the store schema requires.
 *
 * The workspace record schema declares `updatedAt: z.string()`
 * (`dsh-workspace/lib/types/spec.js:23`, `lib/types/index.js:214`), so writing
 * a raw `Date.now()` number — which is what a stage clock returns — would be
 * rejected by the domain's validation and lost. Accepts a number, a date
 * string or nothing.
 */
export function isoStamp(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const date = new Date(typeof value === 'number' && Number.isFinite(value) ? value : Date.now())
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/**
 * Resolve the DSH home directory.
 *
 * Priority: explicit config → `DSH_HOME` → `~/.dsh`. There is no runtime
 * service exposing it (the profile's `dshHomePath()` is a config-time helper),
 * so this stays a plain resolution with an override.
 */
export function resolveDshHome(config = {}) {
  const fromConfig = typeof config.dshHome === 'string' ? config.dshHome.trim() : ''
  if (fromConfig) return resolve(fromConfig)
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (fromEnv) return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/** Every path this plugin touches, resolved once. */
export function resolvePaths(config = {}) {
  const home = resolveDshHome(config)
  return {
    home,
    sessionsRoot: config.sessionsRoot ? resolve(config.sessionsRoot) : join(home, 'sessions'),
    storagesRoot: config.storagesRoot ? resolve(config.storagesRoot) : join(home, 'storages'),
    ledgerFile: config.ledgerFile
      ? resolve(config.ledgerFile)
      : join(home, 'storages', 'workspace.json'),
  }
}

/** Read + parse the workspace ledger file without ever throwing. */
export async function readLedgerFile(file) {
  try {
    const text = await readFile(file, 'utf8')
    return { ok: true, ledger: JSON.parse(text) }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, ledger: undefined, missing: true }
    return { ok: false, error: describeError(error) }
  }
}

/** `stat` a file without throwing: `{ mtimeMs, size }`, or `undefined`. */
async function statStamp(file) {
  try {
    const info = await stat(file)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return undefined
  }
}

/** True when two `statStamp` results describe the same on-disk state. */
function sameStamp(left, right) {
  if (left === undefined || right === undefined) return left === right
  return left.mtimeMs === right.mtimeMs && left.size === right.size
}

/**
 * Atomically replace the workspace ledger file (temp file + rename).
 *
 * The temp name must be unique per write: two writers inside this process that
 * shared one temp path would rename each other's file away (observed as
 * `ENOENT … rename` plus a truncated/trailing-garbage ledger). A per-call
 * counter plus a random suffix keeps concurrent writers apart.
 */
export async function writeLedgerFile(file, ledger) {
  tmpSequence += 1
  const unique = `${process.pid}-${tmpSequence}-${randomSuffix()}`
  const tmp = `${file}.session-delete-${unique}.tmp`
  await mkdir(dirname(file), { recursive: true })
  try {
    await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
  } catch (error) {
    // never leave a stray temp file behind
    try {
      await rm(tmp, { force: true })
    } catch {
      /* best effort */
    }
    throw error
  }
}

let tmpSequence = 0

/** Short random hex suffix for temp file names (no crypto import needed). */
function randomSuffix() {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
}

/**
 * Build the host runtime.
 *
 * @param ctx the plugin's cordis context.
 * @param config plugin config (`dshHome`, `sessionsRoot`, `storagesRoot`,
 *   `allowForce`, `maxBatch`).
 * @param log `(message, meta?) => void`, already exception-safe.
 */
export function createRuntime(ctx, config = {}, log = () => {}) {
  const paths = resolvePaths(config)
  /** Serialises the ledger-file fallback inside this process (see `ledgerFileEdit`). */
  let ledgerChain = Promise.resolve()

  const service = (name) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** Live session object, or `undefined` when the session is not running. */
  const liveSession = (sessionId) => {
    const sessions = service('sessions')
    if (!sessions || typeof sessions.get !== 'function') return undefined
    try {
      return sessions.get(sessionId)
    } catch {
      return undefined
    }
  }

  /** Stored session header (works for non-live sessions), or `undefined`. */
  function sessionHeader(sessionId) {
    const registry = service('workspaceRegistry')
    if (registry && typeof registry.readSessionHeader === 'function') {
      try {
        return registry.readSessionHeader(sessionId) ?? undefined
      } catch {
        /* falls through to the live session header */
      }
    }
    const live = liveSession(sessionId)
    return live?.header
  }

  /**
   * Candidate project directories for this session.
   *
   * The grouping directory under `sessions/` is derived from a cwd snapshot
   * taken when the session was created, and a renamed project leaves the old
   * grouping directory behind (observed live: this very project keeps two
   * grouping names). So cwd is only a *hint*: the disk stage scans the sessions
   * root as well.
   */
  async function knownCwds(sessionId) {
    const found = []
    const push = (value) => {
      if (typeof value === 'string' && value.trim().length > 0 && !found.includes(value)) {
        found.push(value)
      }
    }
    push(sessionHeader(sessionId)?.cwd)
    push(liveSession(sessionId)?.header?.cwd)
    const read = await readLedgerFile(paths.ledgerFile)
    if (read.ok && read.ledger) {
      try {
        for (const workspace of workspacesForSession(read.ledger, sessionId)) push(workspace.path)
      } catch {
        /* a malformed ledger must not break discovery */
      }
    }
    return found
  }

  /** Registry/deferred view of the session, used by the preview endpoint. */
  async function inspect(sessionId) {
    const live = liveSession(sessionId)
    const header = sessionHeader(sessionId)
    const registry = service('workspaceRegistry')
    let known = live !== undefined
    let knownSource = live !== undefined ? 'live' : undefined
    if (registry && typeof registry.sessionKnown === 'function') {
      try {
        if (registry.sessionKnown(sessionId)) {
          known = true
          knownSource = knownSource ?? 'registry'
        }
      } catch {
        /* ignore */
      }
    }
    if (!known && header !== undefined) {
      known = true
      knownSource = 'header'
    }
    return {
      live: live !== undefined,
      known,
      knownSource,
      cwd: typeof header?.cwd === 'string' ? header.cwd : undefined,
    }
  }

  /**
   * The authoritative "is this session busy?" probe.
   *
   * `workspaceRegistry.archiveSession` refuses with `WorkspaceActiveSessionError`
   * when `await ctx.waterfall('workspace/session-activity', { sessionId }, () => [])`
   * returns a non-empty list, so we ask the same question the same way.
   */
  async function activity(sessionId) {
    const waterfall = typeof ctx.waterfall === 'function' ? ctx.waterfall.bind(ctx) : undefined
    if (!waterfall) return { supported: false, list: [] }
    try {
      const list = await waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
      return { supported: true, list: Array.isArray(list) ? list : [] }
    } catch (error) {
      return { supported: false, list: [], error: describeError(error) }
    }
  }

  /** Ask every registered stopper to end the session's activity. */
  async function stopActivity(sessionId) {
    const registry = service('workspaceRegistry')
    if (registry && typeof registry.stopSessionActivity === 'function') {
      try {
        await registry.stopSessionActivity(sessionId)
        return { status: 'ok', detail: '已请求停止会话活动' }
      } catch (error) {
        return { status: 'failed', detail: describeError(error).message }
      }
    }
    const parallel = typeof ctx.parallel === 'function' ? ctx.parallel.bind(ctx) : undefined
    if (!parallel) return { status: 'skipped', detail: '无法停止活动（parallel 能力缺失）' }
    try {
      await parallel('workspace/session-stop', { sessionId })
      return { status: 'ok', detail: '已广播停止请求' }
    } catch (error) {
      return { status: 'failed', detail: describeError(error).message }
    }
  }

  /** Workspace-table cleanup through the registry (keeps its cache coherent). */
  async function workspacesViaRegistry(sessionId, now) {
    const registry = service('workspaceRegistry')
    if (!registry || typeof registry.requireTable !== 'function') return undefined
    let table
    try {
      table = registry.requireTable()
    } catch {
      return undefined
    }
    if (!table || typeof table.update !== 'function' || typeof table.keys !== 'function') {
      return undefined
    }
    const run = async () => {
      const touched = []
      const failures = []
      let keys = []
      try {
        keys = [...table.keys()]
      } catch (error) {
        return { touched, failures: [describeError(error)] }
      }
      for (const key of keys) {
        let record
        try {
          record = typeof table.get === 'function' ? table.get(key) : undefined
        } catch {
          record = undefined
        }
        if (!record || !Array.isArray(record.sessionIds) || !record.sessionIds.includes(sessionId)) {
          continue
        }
        // Prefer the registry's own entity mutator. `detachSession`
        // (`dsh-workspace/lib/index.js:148`) funnels through `mutate()` (`:173`)
        // / `table.update`, which stamps `updatedAt`, prunes candidate accounts
        // and keeps the registry's served entity snapshot coherent. The raw
        // table write below is the fallback for a table-only registry.
        const entity = typeof registry.get === 'function' ? registry.get(key) : undefined
        if (entity && typeof entity.detachSession === 'function') {
          try {
            await entity.detachSession(sessionId)
            touched.push({
              workspaceId: key,
              path: record.path,
              title: record.title,
              via: 'entity',
            })
            continue
          } catch (error) {
            log('workspace entity detachSession failed, falling back to a direct table write', {
              workspaceId: key,
              error: describeError(error),
            })
          }
        }
        try {
          await table.update(key, (current) => ({
            ...current,
            sessionIds: current.sessionIds.filter((id) => id !== sessionId),
            updatedAt: isoStamp(now),
          }))
          touched.push({ workspaceId: key, path: record.path, title: record.title, via: 'table' })
        } catch (error) {
          failures.push({ workspaceId: key, error: describeError(error) })
        }
      }
      return { touched, failures }
    }
    if (typeof registry.enqueueOperation === 'function') {
      try {
        return await registry.enqueueOperation(run)
      } catch (error) {
        log('registry enqueueOperation failed, falling back to direct table writes', {
          error: describeError(error),
        })
      }
    }
    return await run()
  }

  /**
   * Global archived/pinned set cleanup through the registry.
   *
   * Prefers the registry's public idempotent mutators — `unarchiveSession`
   * (`dsh-workspace/lib/index.js:551`) and `unpinSession` (`:596`). Both run
   * inside the registry's own `enqueueOperation` write chain, so they serialise
   * with concurrent registry writes; neither performs a session-existence check,
   * which is exactly what a delete needs. The `setState` spread is only for a
   * registry that lacks those methods (and it stays schema-valid: the global
   * `workspaceDomainState` `:240` carries no `updatedAt`).
   */
  async function globalSetsViaRegistry(sessionId) {
    const registry = service('workspaceRegistry')
    if (!registry) return undefined
    let state
    try {
      state = typeof registry.requireState === 'function' ? registry.requireState() : undefined
    } catch {
      state = undefined
    }
    const observed = state !== null && typeof state === 'object'
    const wasArchived = observed && Array.isArray(state.archivedSessionIds)
      ? state.archivedSessionIds.includes(sessionId)
      : undefined
    const wasPinned = observed && Array.isArray(state.pinnedSessionIds)
      ? state.pinnedSessionIds.includes(sessionId)
      : undefined

    const viaPrimitives = typeof registry.unarchiveSession === 'function'
      && typeof registry.unpinSession === 'function'
    if (viaPrimitives) {
      if (wasArchived === false && wasPinned === false) {
        return { archived: false, pinned: false, changed: false, observed, via: 'registry' }
      }
      // `undefined` means "could not observe" — call the mutator anyway; both
      // are no-ops when the id is absent.
      if (wasArchived !== false) await registry.unarchiveSession(sessionId)
      if (wasPinned !== false) await registry.unpinSession(sessionId)
      return {
        archived: wasArchived === true,
        pinned: wasPinned === true,
        changed: true,
        observed,
        via: 'registry',
      }
    }

    if (!observed || typeof registry.setState !== 'function') return undefined
    const archived = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : []
    const pinned = Array.isArray(state.pinnedSessionIds) ? state.pinnedSessionIds : []
    const hadArchived = archived.includes(sessionId)
    const hadPinned = pinned.includes(sessionId)
    if (!hadArchived && !hadPinned) {
      return { archived: false, pinned: false, changed: false, observed: true, via: 'registry' }
    }
    await registry.setState({
      ...state,
      archivedSessionIds: archived.filter((id) => id !== sessionId),
      pinnedSessionIds: pinned.filter((id) => id !== sessionId),
    })
    return { archived: hadArchived, pinned: hadPinned, changed: true, observed: true, via: 'registry' }
  }

  /**
   * File-level fallback for the workspace ledger.
   *
   * Used only when `workspaceRegistry` is unavailable: the registry owns the
   * in-memory cache, so writing the file underneath a live registry would let
   * the next domain write clobber us.
   *
   * Read → mutate → write is re-checked between read and rename, because a
   * second DSH process sharing this `$DSH_HOME` would otherwise be silently
   * overwritten (lost update). The mutators are pure, so a retry simply re-applies
   * the removal to the fresh content; after three contended attempts the call
   * reports the conflict instead of pretending to have succeeded.
   *
   * Calls are serialised in-process: two concurrent deletes used to interleave
   * their read-modify-write windows (and, with a shared temp name, destroy the
   * ledger outright). Cross-*process* interleaving still relies on the `stat`
   * re-check, because the host offers no usable file lock here.
   */
  function ledgerFileEdit(sessionId, now, scope) {
    const run = () => editLedgerFileOnce(sessionId, now, scope)
    const result = ledgerChain.then(run, run)
    ledgerChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function editLedgerFileOnce(sessionId, now, scope) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await statStamp(paths.ledgerFile)
      const read = await readLedgerFile(paths.ledgerFile)
      if (!read.ok) return { available: false, error: read.error }
      if (!read.ledger) return { available: false, missing: true }
      const verdict = validateLedger(read.ledger)
      if (!verdict.ok) return { available: false, invalid: verdict.reason }
      const result = scope === 'global'
        ? removeSessionFromGlobalSets(read.ledger, sessionId)
        : removeSessionFromWorkspaces(read.ledger, sessionId, now)
      // The pure mutators use different report shapes (`{archived,pinned}` vs
      // `{removed,touched}`), neither of which carries a `changed` flag.
      const changed = scope === 'global'
        ? result.archived === true || result.pinned === true
        : Array.isArray(result.removed) && result.removed.length > 0
      if (!changed) return { available: true, changed: false, ...result }
      const after = await statStamp(paths.ledgerFile)
      if (!sameStamp(before, after)) continue
      await writeLedgerFile(paths.ledgerFile, read.ledger)
      return { available: true, changed: true, ...result, via: 'file' }
    }
    return {
      available: true,
      changed: false,
      conflict: true,
      error: {
        code: 'ledger-contended',
        message: '账本被其他进程反复改写，已放弃写入以避免覆盖他人更新',
      },
    }
  }

  /** Remove this session from every workspace record. */
  async function removeFromWorkspaces(sessionId, now) {
    const stamp = isoStamp(now)
    const viaRegistry = await workspacesViaRegistry(sessionId, stamp)
    if (viaRegistry !== undefined) {
      return {
        via: 'registry',
        touched: viaRegistry.touched,
        failures: viaRegistry.failures,
        changed: viaRegistry.touched.length > 0,
      }
    }
    const viaFile = await ledgerFileEdit(sessionId, stamp, 'workspaces')
    return {
      via: 'file',
      touched: Array.isArray(viaFile.removed) ? viaFile.removed : [],
      failures: [],
      changed: viaFile.changed === true,
      error: viaFile.error,
      invalid: viaFile.invalid,
      missing: viaFile.missing === true,
      unavailable: viaFile.available === false,
    }
  }

  /** Remove this session from the archived / pinned global sets. */
  async function removeFromGlobalSets(sessionId, now) {
    const viaRegistry = await globalSetsViaRegistry(sessionId)
    if (viaRegistry !== undefined) return { via: 'registry', ...viaRegistry }
    const viaFile = await ledgerFileEdit(sessionId, isoStamp(now), 'global')
    return {
      via: 'file',
      archived: viaFile.archived === true,
      pinned: viaFile.pinned === true,
      changed: viaFile.changed === true,
      error: viaFile.error,
      invalid: viaFile.invalid,
      missing: viaFile.missing === true,
      unavailable: viaFile.available === false,
    }
  }

  /** Locate every on-disk trace of the session. */
  async function diskTargets(sessionId) {
    const cwds = await knownCwds(sessionId)
    const found = await findSessionDirs(paths.sessionsRoot, sessionId, { cwds })
    const dirs = []
    for (const dir of found.dirs) {
      try {
        dirs.push({ path: dir, ...(await describeDir(dir)) })
      } catch (error) {
        dirs.push({ path: dir, error: describeError(error).message })
      }
    }
    return { ...found, dirs, cwds }
  }

  /**
   * Drop the `session_projcache` row through the storage domain.
   *
   * Unlinking the backing JSON file underneath a mounted domain is unsafe: the
   * domain holds the record in memory and rewrites it on the next flush.
   * `KvTableImpl.delete(key)` (`dsh-storage-domain/lib/index.js:264`) is the
   * coherent path — it deletes the record and emits `domain/changed`.
   *
   * `open()` is deliberately **not** called: it throws
   * `DomainError("already-open")` for a domain the host already mounted, so the
   * domain is only used when the facility already has it. Returns `undefined`
   * when no domain path is available so the caller can fall back to files.
   */
  async function removeProjectionCacheViaDomain(sessionId) {
    const facility = service('storageDomain')
    if (!facility || typeof facility.get !== 'function') return undefined
    const domain = facility.get('session_projcache')
    if (!domain || typeof domain.table !== 'function') return undefined
    const table = domain.table('sessions')
    if (!table || typeof table.delete !== 'function') return undefined
    const deleted = await table.delete(sessionId)
    return { via: 'domain', removed: deleted === true ? [sessionId] : [], failed: [] }
  }

  /**
   * Delete the projection cache entry (`session_projcache`).
   *
   * The domain delete is **not** sufficient on its own: the backing JSON file is
   * rewritten whenever the domain (or the session's projection) flushes, which
   * happens *after* this runs — a live session writes a final snapshot while it
   * is being disposed. So the file is always swept too, never only as a
   * fallback. Observed live: the cached `Greeting` record came back 27s after a
   * successful delete, which kept the workspace registry claiming the session
   * was `known`. The memory stage sweeps again after the detach for that reason.
   */
  async function sweepProjectionCache(sessionId) {
    let viaDomain
    try {
      viaDomain = await removeProjectionCacheViaDomain(sessionId)
    } catch (error) {
      log('projection cache: storage-domain delete failed, falling back to file removal', {
        error: describeError(error),
      })
    }
    let file
    try {
      file = await removeProjectionCache(paths.home, sessionId)
    } catch (error) {
      file = {
        removed: [],
        failed: [{ path: 'projection-cache', error: describeError(error) }],
      }
    }
    const domainRemoved = viaDomain?.removed ?? []
    const fileRemoved = file.removed ?? []
    const channels = []
    if (domainRemoved.length > 0) channels.push('domain')
    if (fileRemoved.length > 0) channels.push('file')
    return {
      via: channels.length > 0 ? channels.join('+') : viaDomain === undefined ? 'file' : 'domain',
      removed: [...new Set([...domainRemoved, ...fileRemoved])],
      failed: [...(viaDomain?.failed ?? []), ...(file.failed ?? [])],
    }
  }

  /** Delete the session directory trees plus the projection cache entry. */
  async function removeDisk(sessionId, dirs) {
    const removal = await removeSessionDirs(paths.sessionsRoot, sessionId, dirs)
    const cache = await sweepProjectionCache(sessionId)
    return { ...removal, cache }
  }

  /**
   * Drop the session from the host's live store.
   *
   * `sessions` has **no** delete-by-id API, so the sequence is
   * `get(id)` → `liveEntryFor(session)` → `detachEntered(entry)`. Detaching is
   * the canonical path: it removes the store record and, when the entry was
   * announced, dispatches `session/disposed` — which
   * `dsh-api-session-controller` re-emits as `api-session/removed` for the
   * client. `flush` runs first so the JSONL writer releases its handle before
   * the disk retry below (Windows refuses to unlink an open file).
   */
  async function detachFromMemory(sessionId) {
    const sessions = service('sessions')
    if (!sessions || typeof sessions.get !== 'function') {
      return { status: 'skipped', detail: 'sessions 服务不可用（内存阶段降级）' }
    }
    const session = sessions.get(sessionId)
    if (!session) return { status: 'skipped', detail: '会话不在运行态存储中' }

    if (typeof sessions.flush === 'function') {
      try {
        await sessions.flush(session)
      } catch (error) {
        log('flush before detach failed (continuing)', { error: describeError(error) })
      }
    }

    let entry
    if (typeof sessions.liveEntryFor === 'function') {
      try {
        entry = sessions.liveEntryFor(session)
      } catch {
        entry = undefined
      }
    }
    if (entry === undefined) return { status: 'skipped', detail: '会话未在运行态存储中登记' }
    if (typeof sessions.detachEntered !== 'function') {
      return { status: 'skipped', detail: 'sessions.detachEntered 不可用' }
    }
    await sessions.detachEntered(entry)
    return { status: 'ok', detail: '已从运行态存储摘除' }
  }

  /**
   * Re-emit the removal on the client-facing event channel.
   *
   * A failing (or missing) `emit` is reported as `failed`, not `ok`: the stage
   * exists to notify the client, so silence must show up in the report instead
   * of hiding behind a success detail.
   */
  function broadcastRemoved(sessionId) {
    if (typeof ctx.emit !== 'function') {
      return { status: 'failed', detail: '宿主 ctx.emit 不可用，客户端不会收到移除事件' }
    }
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      return {
        status: 'failed',
        detail: `广播 api-session/removed 失败：${describeError(error).message}`,
      }
    }
    return { status: 'ok', detail: '已广播 api-session/removed' }
  }

  /** Everything the confirm dialog needs to describe the deletion. */
  async function preview(sessionId) {
    const valid = isDeletableSessionId(sessionId)
    const info = valid ? await inspect(sessionId) : { live: false, known: false }
    const activityInfo = valid ? await activity(sessionId) : { supported: false, list: [] }
    const targets = valid ? await diskTargets(sessionId) : { dirs: [], cwds: [], scanned: 0 }
    const read = await readLedgerFile(paths.ledgerFile)
    const workspaces = read.ok && read.ledger
      ? workspacesForSession(read.ledger, sessionId)
      : []
    const registry = service('workspaceRegistry')
    let archived = false
    let pinned = false
    if (read.ok && read.ledger?.global) {
      archived = Array.isArray(read.ledger.global.archivedSessionIds)
        && read.ledger.global.archivedSessionIds.includes(sessionId)
      pinned = Array.isArray(read.ledger.global.pinnedSessionIds)
        && read.ledger.global.pinnedSessionIds.includes(sessionId)
    }
    let cache = []
    try {
      cache = projectionCacheCandidates(paths.home, sessionId)
      if (!Array.isArray(cache)) cache = []
    } catch {
      cache = []
    }
    const totalBytes = targets.dirs.reduce((sum, dir) => sum + (Number(dir.bytes) || 0), 0)
    const totalFiles = targets.dirs.reduce((sum, dir) => sum + (Number(dir.files) || 0), 0)
    return {
      sessionId,
      valid,
      known: info.known === true,
      live: info.live === true,
      cwd: info.cwd,
      activity: activityInfo.list,
      activitySupported: activityInfo.supported === true,
      dirs: targets.dirs,
      cwds: targets.cwds,
      totalBytes,
      totalFiles,
      cache,
      workspaces,
      archived,
      pinned,
      registryAvailable: registry !== undefined,
      paths,
      forceAllowed: config.allowForce !== false,
    }
  }

  return {
    paths,
    config,
    log,
    service,
    liveSession,
    sessionHeader,
    knownCwds,
    inspect,
    activity,
    stopActivity,
    removeFromWorkspaces,
    removeFromGlobalSets,
    diskTargets,
    removeDisk,
    sweepProjectionCache,
    detachFromMemory,
    broadcastRemoved,
    preview,
  }
}
