/**
 * Pure operations on the DSH workspace storage unit ("工作区挂账" — the
 * workspace ledger) as persisted by `@deepseek-ai/dsh-workspace` through the
 * `storage-domain` / `storage-json` backend at
 * `<dshHome>/storages/workspace.json`.
 *
 * Observed on-disk shape (v2, verified against a live
 * `C:\Users\ming\.dsh\storages\workspace.json`):
 *
 * ```jsonc
 * {
 *   "unit":   { "name": "workspace", "version": 2 },
 *   "global": {
 *     "initialized": true,
 *     "defaultWorkspaceId": "<id>",
 *     "workspaceIds": ["<workspaceId>", …],
 *     "archivedSessionIds": ["session-…"],
 *     "pinnedSessionIds": []
 *   },
 *   "tables": {
 *     "workspaces": {
 *       "<workspaceId>": {
 *         "path": "D:\\AI_Work",
 *         "title": "AI_Work",
 *         "sessionIds": ["session-…"],
 *         "createdAt": "2026-09-29T15:24:04.040Z",
 *         "updatedAt": "2026-09-29T15:24:04.069Z"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * A session is "挂账" (accounted for) in exactly two places: its entry in one
 * workspace's `sessionIds`, and — if archived/pinned — the corresponding
 * `global` set. Deleting a session must remove it from both, otherwise the
 * sidebar re-materialises a ghost row on the next boot.
 *
 * All mutators operate in place on the parsed ledger object and return a
 * report, so the caller can hand the very object the host has cached.
 */

/** Storage unit name this module understands. */
export const WORKSPACE_UNIT_NAME = 'workspace'

/** Storage unit version this module understands. */
export const WORKSPACE_UNIT_VERSION = 2

/**
 * Structural validation of a parsed workspace ledger.
 *
 * @param ledger parsed `workspace.json` value.
 * @returns `{ ok: true }` or `{ ok: false, reason }` (never throws).
 */
export function validateLedger(ledger) {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return { ok: false, reason: 'workspace ledger is not an object' }
  }
  const global = ledger.global
  if (global === null || typeof global !== 'object' || Array.isArray(global)) {
    return { ok: false, reason: 'workspace ledger has no `global` object' }
  }
  if (!Array.isArray(global.archivedSessionIds)) {
    return { ok: false, reason: 'workspace ledger `global.archivedSessionIds` is not an array' }
  }
  const tables = ledger.tables
  if (tables !== null && tables !== undefined && (typeof tables !== 'object' || Array.isArray(tables))) {
    return { ok: false, reason: 'workspace ledger `tables` is not an object' }
  }
  const workspaces = tables?.workspaces
  if (workspaces !== null && workspaces !== undefined && (typeof workspaces !== 'object' || Array.isArray(workspaces))) {
    return { ok: false, reason: 'workspace ledger `tables.workspaces` is not an object' }
  }
  return { ok: true }
}

/**
 * The `tables.workspaces` map of a ledger, or an empty object.
 *
 * @param ledger parsed workspace ledger.
 */
export function workspaceTable(ledger) {
  const workspaces = ledger?.tables?.workspaces
  return workspaces !== null && typeof workspaces === 'object' && !Array.isArray(workspaces) ? workspaces : {}
}

/**
 * Workspace records that currently list `sessionId`.
 *
 * @param ledger parsed workspace ledger.
 * @param sessionId raw session id (no encoding).
 * @returns array of `{ workspaceId, path, title }`.
 */
export function workspacesForSession(ledger, sessionId) {
  const out = []
  for (const [workspaceId, record] of Object.entries(workspaceTable(ledger))) {
    if (!Array.isArray(record?.sessionIds)) continue
    if (!record.sessionIds.includes(sessionId)) continue
    out.push({ workspaceId, path: record.path, title: record.title })
  }
  return out
}

/**
 * Every project path known to the ledger, de-duplicated, in stable order.
 * Used to probe the on-disk session layout when the session's own `cwd` is not
 * recorded anywhere else.
 *
 * @param ledger parsed workspace ledger.
 * @returns array of absolute paths.
 */
export function knownProjectPaths(ledger) {
  const out = []
  const seen = new Set()
  for (const record of Object.values(workspaceTable(ledger))) {
    const path = record?.path
    if (typeof path !== 'string' || path.length === 0 || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/**
 * Remove `sessionId` from every workspace's `sessionIds` accounting list.
 *
 * Every occurrence is dropped, not just the first: a ledger written by an older
 * or buggy host build can list the same id twice, and leaving one behind keeps
 * the session "known" so it comes back after a reload — while the stage would
 * still report success.
 *
 * @param ledger parsed workspace ledger (mutated in place).
 * @param sessionId raw session id.
 * @param now optional ISO timestamp applied to touched `updatedAt` fields.
 * @returns `{ removed: [{ workspaceId, path, title, count }], touched: number }`.
 */
export function removeSessionFromWorkspaces(ledger, sessionId, now) {
  const removed = []
  for (const [workspaceId, record] of Object.entries(workspaceTable(ledger))) {
    if (!Array.isArray(record?.sessionIds)) continue
    const kept = record.sessionIds.filter((id) => id !== sessionId)
    const count = record.sessionIds.length - kept.length
    if (count === 0) continue
    record.sessionIds = kept
    if (now !== undefined) record.updatedAt = now
    removed.push({ workspaceId, path: record.path, title: record.title, count })
  }
  return { removed, touched: removed.length }
}

/**
 * Remove `sessionId` from the ledger's global archived / pinned sets. Both are
 * cleaned because a pinned-then-deleted session would otherwise keep a stale
 * pin entry forever.
 *
 * @param ledger parsed workspace ledger (mutated in place).
 * @param sessionId raw session id.
 * @returns `{ archived: boolean, pinned: boolean }` — which sets were pruned.
 */
export function removeSessionFromGlobalSets(ledger, sessionId) {
  const report = { archived: false, pinned: false }
  const global = ledger?.global
  if (global === null || typeof global !== 'object') return report
  if (Array.isArray(global.archivedSessionIds)) {
    const kept = global.archivedSessionIds.filter((id) => id !== sessionId)
    report.archived = kept.length !== global.archivedSessionIds.length
    global.archivedSessionIds = kept
  }
  if (Array.isArray(global.pinnedSessionIds)) {
    const kept = global.pinnedSessionIds.filter((id) => id !== sessionId)
    report.pinned = kept.length !== global.pinnedSessionIds.length
    global.pinnedSessionIds = kept
  }
  return report
}

/**
 * One-call ledger cleanup: workspace accounting + global archived/pinned sets.
 *
 * @param ledger parsed workspace ledger (mutated in place).
 * @param sessionId raw session id.
 * @param now optional ISO timestamp applied to touched `updatedAt` fields.
 * @returns `{ workspaces: [{workspaceId,path,title}], archived, pinned, changed }`
 *   where `changed` is true when the ledger was actually modified.
 */
export function removeSessionFromLedger(ledger, sessionId, now) {
  const validation = validateLedger(ledger)
  if (!validation.ok) {
    return { workspaces: [], archived: false, pinned: false, changed: false, invalid: validation.reason }
  }
  const { removed } = removeSessionFromWorkspaces(ledger, sessionId, now)
  const sets = removeSessionFromGlobalSets(ledger, sessionId)
  return {
    workspaces: removed,
    archived: sets.archived,
    pinned: sets.pinned,
    changed: removed.length > 0 || sets.archived || sets.pinned,
  }
}

/**
 * Whether the ledger still accounts for `sessionId` anywhere.
 *
 * @param ledger parsed workspace ledger.
 * @param sessionId raw session id.
 */
export function ledgerHasSession(ledger, sessionId) {
  if (removeSessionIsPresent(ledger?.global?.archivedSessionIds, sessionId)) return true
  if (removeSessionIsPresent(ledger?.global?.pinnedSessionIds, sessionId)) return true
  return workspacesForSession(ledger, sessionId).length > 0
}

function removeSessionIsPresent(list, sessionId) {
  return Array.isArray(list) && list.includes(sessionId)
}
