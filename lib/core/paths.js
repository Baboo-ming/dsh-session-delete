/**
 * Faithful port of the on-disk session layout owned by the DSH package
 * `@deepseek-ai/dsh-session-persistence-jsonl`.
 *
 * Verified against the shipped bundle
 * `.ref/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`
 * (`encodeSegment` at :853-865, `projectKey` at :875-894, `projectDir` at
 * :902-905, `sessionDir` at :914-916, `generationLogFilename` at :761-763).
 *
 * The layout is:
 *
 *   <root>/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v4.jsonl.zstd
 *
 * where `<root>` is the configured `session-persistence-jsonl` root
 * (`dshHomePath('sessions')` in the shipped desktop profile, i.e.
 * `~/.dsh/sessions`), the project directory name is a lossy human-readable
 * slug, and both the session directory and the log filename are
 * version-injected so future format generations can coexist.
 *
 * We never guess the log filename when deleting: the whole session directory
 * is owned by that one session ("The directory owned by one session and
 * available for future session-local artifacts"), so removing it verbatim
 * covers every generation, the per-session lock file and any future artifact.
 */

/** Characters allowed to appear literally in an encoded path segment. */
const SAFE_CODE_UNIT = /^[A-Za-z0-9._-]$/

/**
 * Escape one arbitrary UTF-16 string into a single safe path segment,
 * injectively. Mirrors the host's `encodeSegment`: safe code units stay
 * literal, everything else (including `~` itself) becomes `~XXXX`, with
 * uppercase hexadecimal and a 4-digit minimum. `.` and `..` are special-cased
 * so an otherwise-safe whole segment cannot traverse.
 *
 * @param raw non-empty string to encode.
 * @returns the encoded single path segment.
 */
export function encodeSegment(raw) {
  if (typeof raw !== 'string') throw new TypeError('encodeSegment expects a string')
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && SAFE_CODE_UNIT.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the human-navigable project directory key for a session's `cwd`.
 * Mirrors the host's `projectKey`: runs of `/`, `\` and `:` collapse to one
 * `-`, unsafe code units use the same `~XXXX` escape as session ids, leading
 * dashes are dropped, the result is truncated to 251 characters and wrapped in
 * `--`. When nothing readable survives (an empty cwd or a pure separator path)
 * the host falls back to the literal `root`.
 *
 * @param cwd absolute project path.
 * @returns the project directory name (with the `--…--` wrapper).
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string') {
    throw new TypeError('projectKey expects a string')
  }
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && SAFE_CODE_UNIT.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const trimmed = readable.replace(/^-+/, '') || 'root'
  return `--${trimmed.slice(0, 251)}--`
}

/**
 * The project directory under the session root for one `cwd`.
 *
 * @param root configured session root directory.
 * @param cwd session project path; `undefined` selects the `_no-cwd` bucket.
 * @param joinFn path join implementation (`node:path`'s `join`).
 */
export function projectDir(root, cwd, joinFn) {
  return cwd === undefined || cwd === null || cwd === ''
    ? joinFn(root, '_no-cwd')
    : joinFn(root, projectKey(cwd))
}

/**
 * The directory owned by exactly one session.
 *
 * @param root configured session root directory.
 * @param cwd session project path (may be undefined → `_no-cwd`).
 * @param id raw (unencoded) session id.
 * @param joinFn path join implementation (`node:path`'s `join`).
 */
export function sessionDir(root, cwd, id, joinFn) {
  return joinFn(projectDir(root, cwd, joinFn), encodeSegment(id))
}

/**
 * Candidate session directories to probe when the session's `cwd` is unknown:
 * the encoded session directory under every distinct candidate cwd, plus the
 * `_no-cwd` bucket.
 *
 * @param root configured session root directory.
 * @param cwds candidate project paths (may contain duplicates/undefined).
 * @param id raw (unencoded) session id.
 * @param joinFn path join implementation (`node:path`'s `join`).
 * @returns de-duplicated absolute candidate directories, in stable order.
 */
export function candidateSessionDirs(root, cwds, id, joinFn) {
  const out = []
  const seen = new Set()
  const push = (dir) => {
    if (seen.has(dir)) return
    seen.add(dir)
    out.push(dir)
  }
  for (const cwd of cwds) {
    if (typeof cwd !== 'string' || cwd.length === 0) continue
    push(sessionDir(root, cwd, id, joinFn))
  }
  push(sessionDir(root, undefined, id, joinFn))
  return out
}
