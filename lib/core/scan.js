/**
 * On-disk session discovery and removal.
 *
 * Why scan instead of only deriving the path: the shipped layout puts a
 * session directory under a *lossy* project slug (`projectKey(cwd)`), and that
 * slug is frozen at the moment the log directory is first created. Renaming a
 * project folder, or opening the same session from a second cwd, therefore
 * leaves the session's real directory under a slug that the session's current
 * `cwd` no longer reproduces — observed live on this machine, where
 * `D:\AI_Work\开发\删除会话插件` owns a project directory whose encoding
 * corresponds to a three-segment path.
 *
 * Deriving is used only as a cheap hint; discovery walks `root/*` one level
 * deep and keeps every `<projectDir>/<encodeSegment(sessionId)>` that exists,
 * so orphaned slugs are cleaned too. Every removal is guarded by a basename and
 * containment check so a bug can never turn into `rm -rf` of a project or the
 * session root itself.
 */

import {
  readdir as fsReaddir,
  lstat as fsLstat,
  realpath as fsRealpath,
  stat as fsStat,
  rm as fsRm,
  rmdir as fsRmdir,
  readFile as fsReadFile,
} from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

import { encodeSegment, candidateSessionDirs } from './paths.js'

/** A session log generation, e.g. `session.jsonl` / `session.v4.jsonl.zstd`. */
export const SESSION_LOG_PATTERN = /^session(\.v\d+)?\.jsonl(\.zstd)?$/

/** Per-session write-lease file convention (generation 0 keeps `session.lock`). */
const LOCK_PATTERN = /^session(\.v\d+)?\.lock$/

/**
 * Everything that is unambiguously *this* session's storage inside a directory:
 * `session.jsonl` / `session.v<N>.jsonl` plus an optional `.zstd` suffix, the
 * `session.lock` write lease, and a writer's `.tmp` leftovers.
 *
 * It matters when a session directory is a link to a directory that is *not*
 * named after the session: only these entries are then removed, so a wrong or
 * hostile link can never turn into a recursive delete of an unrelated tree.
 */
const SESSION_ARTIFACT_PATTERN = /^(?:session(?:\.v\d+)?\.lock|session(?:\.v\d+)?\.jsonl(?:\.zstd)?(?:\.tmp)?)$/

const defaultIo = {
  readdir: fsReaddir,
  lstat: fsLstat,
  realpath: fsRealpath,
  stat: fsStat,
  rm: fsRm,
  rmdir: fsRmdir,
  readFile: fsReadFile,
}

function io(deps) {
  return { ...defaultIo, ...(deps ?? {}) }
}

/**
 * Whether `dir` is a strict descendant of `root` whose basename is exactly the
 * encoded form of `sessionId`. This is the single guard standing between a
 * typo and a recursive delete, so it is deliberately strict (case-insensitive,
 * Windows-friendly) and never relies on the caller.
 *
 * @param root session root (`<dshHome>/sessions`).
 * @param sessionId raw session id.
 * @param dir candidate directory.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function assertRemovable(root, sessionId, dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return { ok: false, reason: '空路径' }
  }
  let expected
  try {
    expected = encodeSegment(sessionId)
  } catch (error) {
    return { ok: false, reason: `无法编码会话 ID：${error.message}` }
  }
  const rootAbs = resolve(root)
  const dirAbs = resolve(dir)
  const prefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep
  if (dirAbs.toLowerCase() === rootAbs.toLowerCase()) {
    return { ok: false, reason: '拒绝删除会话根目录本身' }
  }
  if (!dirAbs.toLowerCase().startsWith(prefix.toLowerCase())) {
    return { ok: false, reason: `拒绝删除会话根目录之外的目标：${dirAbs}` }
  }
  const parts = dirAbs.slice(prefix.length).split(sep).filter(Boolean)
  if (parts.length !== 2) {
    return { ok: false, reason: `拒绝删除非「项目/会话」两级布局：${dirAbs}` }
  }
  if (parts[1] !== expected) {
    return { ok: false, reason: `目录名与会话 ID 不匹配：${parts[1]} ≠ ${expected}` }
  }
  return { ok: true }
}

/**
 * Discover every existing session directory for `sessionId` under `root`.
 *
 * @param root session root directory.
 * @param sessionId raw session id.
 * @param options.cwds candidate cwds used only to add *hints* to the scan.
 * @param options.deps injectable `{ readdir, stat }` (tests).
 * @returns `{ dirs, hints, scanned, checked }` — `dirs` are absolute and
 *   already validated by {@link assertRemovable}.
 */
export async function findSessionDirs(root, sessionId, options = {}) {
  const { readdir, stat } = io(options.deps)
  const hints = candidateSessionDirs(root, options.cwds ?? [], sessionId, join)
  const all = new Set()
  let scanned = 0

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    entries = []
  }
  const segment = encodeSegment(sessionId)
  for (const entry of entries) {
    // A reparse point (junction / directory symlink) at the *project* level has
    // to be walked as well: `Dirent.isDirectory()` is `false` for a link, and
    // moving a heavy project tree to another volume with a link is a normal
    // user setup.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    scanned += 1
    all.add(join(root, entry.name, segment))
  }
  for (const hint of hints) all.add(hint)

  const dirs = []
  let checked = 0
  for (const candidate of all) {
    checked += 1
    try {
      const info = await stat(candidate)
      if (!info.isDirectory()) continue
    } catch {
      continue
    }
    if (!assertRemovable(root, sessionId, candidate).ok) continue
    dirs.push(resolve(candidate))
  }
  return { dirs, hints, scanned, checked }
}

/**
 * Cheap description of a directory's contents, for the confirmation UI and the
 * pre-delete report (`{ files, bytes, logs }`).
 *
 * @param dir session directory.
 * @param options.deps injectable `{ readdir, stat }`.
 */
export async function describeDir(dir, options = {}) {
  const { readdir, stat } = io(options.deps)
  const summary = { files: 0, bytes: 0, logs: 0, generation: undefined, locked: false }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return summary
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      summary.files += 1
      continue
    }
    summary.files += 1
    if (LOCK_PATTERN.test(entry.name)) summary.locked = true
    if (SESSION_LOG_PATTERN.test(entry.name)) {
      summary.logs += 1
      const version = /^session\.v(\d+)\./.exec(entry.name)
      if (version) summary.generation = `v${version[1]}`
    }
    try {
      const info = await stat(join(dir, entry.name))
      summary.bytes += info.size
    } catch {
      /* unreadable file: size simply not counted */
    }
  }
  return summary
}

/**
 * Recursively remove validated session directories, then prune the project
 * directory when the deletion left it empty.
 *
 * @param root session root directory.
 * @param sessionId raw session id.
 * @param dirs directories from {@link findSessionDirs}.
 * @param options.deps injectable `{ rm, rmdir, readdir, stat }`.
 * @returns `{ removed: [{dir, summary, viaLink?, target?, scoped?, leftover?}], failed: [{dir, error}], pruned: string[], pruneFailed: [{dir, error}] }`.
 *   `viaLink` marks a directory that was a link and had its target removed;
 *   `scoped` marks a target that was not named after the session and therefore
 *   lost only its session artifacts, with any surviving entries in `leftover`.
 */
export async function removeSessionDirs(root, sessionId, dirs, options = {}) {
  const { rm, rmdir, readdir, lstat, realpath } = io(options.deps)
  const removed = []
  const failed = []
  const pruned = []
  const pruneFailed = []
  let expected
  try {
    expected = encodeSegment(sessionId)
  } catch {
    expected = undefined
  }

  for (const dir of dirs) {
    const guard = assertRemovable(root, sessionId, dir)
    if (!guard.ok) {
      failed.push({ dir, error: guard.reason })
      continue
    }
    // A session directory that is *itself* a reparse point is the one layout
    // where `rm(dir, { recursive: true })` does NOT delete the logs: Node sees a
    // link and unlinks the link only, leaving every file behind on the other
    // volume (verified on Windows with `mklink /J`). So the link target is
    // resolved first and deleted as well.
    //
    // How much of the target may go depends on the target's name:
    //  * basename === encoded session id  → the directory *is* this session's
    //    directory (the layout the host itself uses when data was relocated), so
    //    it is removed recursively;
    //  * any other name                  → the link is the user's relocation,
    //    not proof of ownership: remove only the session artifacts inside it and
    //    then drop the directory if that left it empty. A link aimed at an
    //    unrelated directory holds no such artifact and is refused outright.
    let linkTarget
    let scopedArtifacts
    try {
      const info = await lstat(dir)
      if (info.isSymbolicLink()) {
        try {
          linkTarget = await realpath(dir)
        } catch {
          linkTarget = undefined // dangling link: there is nothing behind it
        }
        if (linkTarget !== undefined && expected !== undefined
          && basename(linkTarget).toLowerCase() !== expected.toLowerCase()) {
          const names = await readdir(linkTarget).catch(() => undefined)
          const artifacts = (names ?? []).filter((name) => SESSION_ARTIFACT_PATTERN.test(name))
          if (artifacts.length === 0) {
            failed.push({
              dir,
              error: `目录链接的目标不是会话存储（未找到 session.jsonl / session.lock 等文件），拒绝删除：${linkTarget}`,
            })
            continue
          }
          scopedArtifacts = artifacts
        }
      }
    } catch (error) {
      failed.push({ dir, error: error?.message ?? String(error) })
      continue
    }
    const summary = await describeDir(dir, options)
    let leftover
    try {
      // Payload first, link second: if the payload is locked, the link is still
      // there and the memory stage's leftover retry can target the same path.
      if (scopedArtifacts !== undefined) {
        for (const name of scopedArtifacts) {
          await rm(join(linkTarget, name), { recursive: true, force: true, maxRetries: 3 })
        }
        try {
          await rmdir(linkTarget)
        } catch (error) {
          const code = error?.code
          if (code === 'ENOTEMPTY' || code === 'EEXIST') {
            leftover = await readdir(linkTarget).catch(() => [])
          } else if (code !== 'ENOENT') {
            throw error
          }
        }
      } else if (linkTarget !== undefined) {
        await rm(linkTarget, { recursive: true, force: true, maxRetries: 3 })
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      failed.push({ dir, error: error?.message ?? String(error) })
      continue
    }
    removed.push({
      dir,
      summary,
      ...(linkTarget !== undefined ? { viaLink: true, target: linkTarget, scoped: scopedArtifacts !== undefined } : {}),
      ...(Array.isArray(leftover) && leftover.length > 0 ? { leftover } : {}),
    })
    const parent = resolve(join(dir, '..'))
    try {
      const left = await readdir(parent)
      if (left.length === 0) {
        // `rmdir` (not `rm`) is deliberate: it refuses a non-empty directory,
        // so a race that recreates a file can never delete real content.
        await rmdir(parent)
        pruned.push(parent)
      }
    } catch (error) {
      const code = error?.code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        pruneFailed.push({ dir: parent, error: error?.message ?? String(error) })
      }
    }
  }
  return { removed, failed, pruned, pruneFailed }
}

/**
 * Candidate projection-cache files for a session. The shipped profile uses
 * `session-projection-cache` on top of the `json` storage backend, which lands
 * at `<dshHome>/storages/session_projcache/sessions/<sessionId>.json`.
 *
 * @param dshHome DSH home directory.
 * @param sessionId raw session id.
 * @returns absolute candidate paths (existence not verified).
 */
export function projectionCacheCandidates(dshHome, sessionId) {
  if (typeof dshHome !== 'string' || dshHome.length === 0) return []
  return [join(dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)]
}

/**
 * Remove the session's projection cache file(s).
 *
 * @param dshHome DSH home directory.
 * @param sessionId raw session id.
 * @param options.deps injectable `{ rm, stat }`.
 */
export async function removeProjectionCache(dshHome, sessionId, options = {}) {
  const { rm, stat } = io(options.deps)
  const removed = []
  for (const candidate of projectionCacheCandidates(dshHome, sessionId)) {
    try {
      const info = await stat(candidate)
      if (!info.isFile()) continue
      await rm(candidate, { force: true })
      removed.push(candidate)
    } catch {
      /* absent cache file is the normal case */
    }
  }
  return { removed }
}
