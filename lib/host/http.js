/**
 * HTTP surface for the deletion pipeline.
 *
 * A plugin-owned route is the only cheap way to reach host-side capabilities
 * from the browser: the shipped `remote.session.*` namespace has no delete
 * method, and shipping a `./typert` manifest would drag in a strict-codec
 * contract we do not need (`dsh-memory-evolve` uses exactly this
 * `webServer.register({ kind: 'prefix', … })` route pattern).
 *
 * Contract: every response is `{ ok: true, value }` or
 * `{ ok: false, error: { code, message, detail? } }`.
 */
import { timingSafeEqual } from 'node:crypto'

import { describeError } from '../core/pipeline.js'
import { isDeletableSessionId } from './runtime.js'

const MAX_BODY_BYTES = 256 * 1024

/** `application/json`, optionally with parameters — and nothing else. */
const JSON_CONTENT_TYPE = /^application\/json\s*(?:;|$)/iu

/** Send a JSON response; never throws into the server. */
function sendJson(res, status, payload) {
  let body
  try {
    body = JSON.stringify(payload)
  } catch {
    body = JSON.stringify({ ok: false, error: { code: 'unserialisable', message: '响应无法序列化' } })
    status = 500
  }
  try {
    res.statusCode = status
    if (typeof res.setHeader === 'function') {
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
    }
    res.end(body)
  } catch {
    try {
      res.end()
    } catch {
      /* the peer is gone; nothing left to do */
    }
  }
}

/** Read and parse a JSON request body, cap-guarded, empty body → `{}`. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('请求体过大')
      error.code = 'body-too-large'
      throw error
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.code = 'invalid-json'
    throw error
  }
}

function errorPayload(error, fallbackCode = 'internal-error') {
  const described = describeError(error)
  return { ok: false, error: { code: described.code ?? fallbackCode, message: described.message } }
}

/** Read one request header without assuming a Node or a test-shaped request. */
function header(req, name) {
  const bag = req?.headers
  if (bag && typeof bag === 'object') {
    const value = bag[name] ?? bag[name.toLowerCase()]
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : undefined
  }
  if (typeof req?.getHeader === 'function') {
    try {
      const value = req.getHeader(name)
      if (typeof value === 'string') return value.trim()
    } catch {
      /* fall through */
    }
  }
  return undefined
}

/**
 * True when `origin` identifies the very host that served the request.
 *
 * Host names are case-insensitive, and a scheme mismatch is refused whenever the
 * request tells us its own scheme (`x-forwarded-proto`): an `https:` page is not
 * the same origin as a plain-`http:` API, even on the same host. Without that
 * header we only require a sane scheme, so a reverse-proxied GUI keeps working.
 */
function sameOrigin(origin, host, forwardedProto) {
  if (typeof host !== 'string' || host.length === 0) return false
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.host.toLowerCase() !== host.toLowerCase()) return false
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    const expected = forwardedProto.split(',')[0].trim().toLowerCase().replace(/:$/u, '')
    if (expected.length > 0 && `${expected}:` !== parsed.protocol) return false
  }
  return true
}

/** Constant-time token comparison (a length mismatch is not secret). */
function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Reject cross-site requests before they can mutate anything.
 *
 * The host's own web server installs no CSRF protection (`dsh-host-webserver`
 * has no origin check and may even bind `0.0.0.0`), and this route deletes
 * user data, so the plugin guards itself:
 *
 * - `sec-fetch-site: cross-site` is refused outright (current browsers send it,
 *   and it is not settable by page script);
 * - a present `origin` must identify the same host that served the request;
 * - state-changing POSTs must be `application/json`, which a browser cannot send
 *   cross-site without a CORS preflight this server never grants — that blocks
 *   the `text/plain` / form-encoded "simple request" bypass;
 * - every route except `GET /session-delete/health` must additionally carry the
 *   per-boot `x-session-delete-token` that `/health` hands out. A cross-site page
 *   can send a blind request but can never *read* the health response (this
 *   server emits no CORS header), so it cannot learn the token — that closes the
 *   remaining hole of a request that carries neither `origin` nor
 *   `sec-fetch-site`. `/health` itself is read-only and returns nothing but the
 *   version and the token.
 *
 * Non-browser callers (curl, scripts, tests) send no `origin` and no
 * `sec-fetch-site`; they must send the token when one is configured. Returns
 * `undefined` when allowed.
 */
function guardRequest(req, { requireJson = false, token = null } = {}) {
  const site = header(req, 'sec-fetch-site')
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
    return { status: 403, code: 'cross-site-blocked', message: '拒绝跨站请求' }
  }
  const origin = header(req, 'origin')
  if (typeof origin === 'string' && origin.length > 0) {
    if (origin.toLowerCase() === 'null') {
      // opaque origin: sandboxed iframe / `data:` page / redirect-crossing request
      return {
        status: 403,
        code: 'cross-origin-blocked',
        message: '拒绝来源不明的请求（Origin: null）',
      }
    }
    if (!sameOrigin(origin, header(req, 'host'), header(req, 'x-forwarded-proto'))) {
      return { status: 403, code: 'cross-origin-blocked', message: `拒绝跨源请求：${origin}` }
    }
  }
  if (requireJson) {
    const type = header(req, 'content-type')
    // Strict match: `application/json` optionally followed by parameters
    // (`; charset=utf-8`). A substring test would also accept
    // `application/jsonp`, which browsers *can* send cross-site without a
    // preflight — exactly the simple-request shape this gate exists to stop.
    if (typeof type !== 'string' || !JSON_CONTENT_TYPE.test(type.trim())) {
      return {
        status: 415,
        code: 'unsupported-media-type',
        message: '删除请求必须使用 application/json',
      }
    }
  }
  if (typeof token === 'string' && token.length > 0) {
    if (!tokenMatches(header(req, 'x-session-delete-token'), token)) {
      return {
        status: 403,
        code: 'invalid-token',
        message: '缺少或无效的请求令牌，请刷新页面后重试',
      }
    }
  }
  return undefined
}

/**
 * @param options.runtime   `createRuntime()` result.
 * @param options.deleteSession `(sessionId, { force }) => Promise<report>`.
 * @param options.log       exception-safe logger.
 * @param options.version   plugin version string.
 * @param options.token     per-boot request token; `null` disables the check.
 * @returns a `(req, res) => Promise<void>` handler for `webServer.register`.
 */
export function createHandler({
  runtime,
  deleteSession,
  log = () => {},
  version = '0.0.0',
  token = null,
}) {
  const requireToken = typeof token === 'string' && token.length > 0
  return async function handler(req, res) {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'bad-url', message: '无法解析请求 URL' } })
      return
    }
    const path = url.pathname.replace(/\/+$/u, '') || '/'
    // `/session-delete` is accepted as an alias of `/session-delete/delete`
    // (`/session-delete/` normalises to it above, so that branch is reachable).
    const isDelete = path === '/session-delete/delete' || path === '/session-delete'
    try {
      // One admission point for every route: cross-site/origin checks always,
      // JSON + token on the state-changing POST, token everywhere except
      // `/health` (which is what hands the token to a same-origin page).
      const blocked = guardRequest(req, {
        requireJson: isDelete && req.method === 'POST',
        token: path === '/session-delete/health' ? null : token,
      })
      if (blocked !== undefined) {
        log(`http ${path} blocked: ${blocked.code}`, { origin: header(req, 'origin') })
        sendJson(res, blocked.status, { ok: false, error: { code: blocked.code, message: blocked.message } })
        return
      }

      if (path === '/session-delete/health') {
        // Deliberately minimal: the UI needs nothing but the token, and the
        // route answers to any same-origin caller.
        sendJson(res, 200, {
          ok: true,
          value: {
            name: 'dsh-session-delete',
            version,
            token: requireToken ? token : undefined,
            requireToken,
          },
        })
        return
      }

      if (path === '/session-delete/preview') {
        const body = req.method === 'POST' ? await readJson(req) : {}
        const sessionId = body.sessionId ?? url.searchParams.get('sessionId')
        if (!isDeletableSessionId(sessionId)) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'invalid-session-id', message: '会话 ID 缺失或非法' },
          })
          return
        }
        const preview = await runtime.preview(sessionId)
        sendJson(res, 200, { ok: true, value: preview })
        return
      }

      if (isDelete) {
        if (req.method !== 'POST') {
          sendJson(res, 405, {
            ok: false,
            error: { code: 'method-not-allowed', message: '删除会话必须使用 POST' },
          })
          return
        }
        const body = await readJson(req)
        const sessionId = body.sessionId
        if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'invalid-session-id', message: '会话 ID 缺失' },
          })
          return
        }
        if (!isDeletableSessionId(sessionId)) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'invalid-session-id', message: `会话 ID 含非法字符：${sessionId}` },
          })
          return
        }
        const force = body.force === true
        if (force && runtime.config.allowForce === false) {
          sendJson(res, 403, {
            ok: false,
            error: { code: 'force-not-allowed', message: '该插件配置禁止强制删除运行中的会话' },
          })
          return
        }
        const report = await deleteSession(sessionId, { force })
        const status = report.refused === true ? 409 : 200
        sendJson(res, status, { ok: report.deleted === true, value: report })
        return
      }

      sendJson(res, 404, {
        ok: false,
        error: { code: 'not-found', message: `未知路由：${path}` },
      })
    } catch (error) {
      const described = describeError(error)
      log(`http ${path} failed`, { error: described })
      if (described.code === 'body-too-large') {
        // Answer first, then *drain* (never `req.destroy()`) the remaining
        // upload. Measured over a real socket: destroying the request right
        // after `res.end()` races the 413 out of the client's hands — a client
        // that is still uploading sees `ECONNRESET` instead of a readable 413.
        // `connection: close` still bounds the work: the socket goes away as
        // soon as the response is flushed.
        try {
          if (typeof res.setHeader === 'function') res.setHeader('connection', 'close')
        } catch {
          /* headers already sent */
        }
        sendJson(res, 413, errorPayload(error))
        try {
          req.resume?.()
        } catch {
          /* already gone */
        }
        return
      }
      // A malformed body is the caller's fault, not a server fault.
      sendJson(res, described.code === 'invalid-json' ? 400 : 500, errorPayload(error))
    }
  }
}
