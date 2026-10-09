/**
 * Host-half integration tests: pipeline + adapters + HTTP contract.
 *
 * They run against a *real* temporary DSH home (sessions/ + storages/) so the
 * filesystem stages are exercised for real, and against a stub cordis context
 * so no DSH process is needed.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { encodeSegment, projectDir } from '../lib/core/paths.js'
import { createStages } from '../lib/host/stages.js'
import { createSessionDeleter } from '../lib/index.js'
import { isDeletableSessionId } from '../lib/host/runtime.js'

const SESSION_ID = 'session-11111111-2222-3333-4444-555555555555'
const CWD = join('D:', 'AI_Work', '开发', '删除会话插件')
const WORKSPACE_ID = 'ws-abc'

/** Build a fake DSH home with one session on disk. */
async function makeHome({ archived = true, pinned = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'session-delete-'))
  const sessionsRoot = join(home, 'sessions')
  const dir = join(projectDir(sessionsRoot, CWD, join), encodeSegment(SESSION_ID))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), Buffer.from('deadbeef', 'hex'))
  await writeFile(join(dir, 'session.lock'), '')

  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, `${SESSION_ID}.json`), '{"version":7}')

  const workspaceFile = join(home, 'storages', 'workspace.json')
  await writeFile(
    workspaceFile,
    JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: {
        initialized: true,
        defaultWorkspaceId: WORKSPACE_ID,
        workspaceIds: [WORKSPACE_ID],
        archivedSessionIds: archived ? [SESSION_ID] : [],
        pinnedSessionIds: pinned ? [SESSION_ID] : [],
      },
      tables: {
        workspaces: {
          [WORKSPACE_ID]: {
            path: CWD,
            title: '删除会话插件',
            sessionIds: [SESSION_ID, 'session-keep-me'],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    }, null, 2)
  )

  return { home, sessionsRoot, dir, cacheFile: join(cacheDir, `${SESSION_ID}.json`), workspaceFile }
}

/**
 * Stub cordis context + services.
 *
 * `registry: false` exercises the ledger-file fallback; `entity: false` keeps
 * the registry but drops its `get(key).detachSession` entity mutator;
 * `primitives: false` drops `unarchiveSession`/`unpinSession`; `storageDomain`
 * mounts a fake `session_projcache` domain whose `delete` removes `cacheFile`.
 */
function makeCtx({
  id = SESSION_ID,
  live = false,
  activity = [],
  registry = true,
  detachFails = false,
  entity = true,
  primitives = true,
  storageDomain = false,
  emitFails = false,
  cacheFile,
} = {}) {
  const calls = {
    detach: 0,
    flush: 0,
    stop: 0,
    updates: [],
    state: null,
    effects: 0,
    injected: [],
    entityDetach: [],
    unarchive: [],
    unpin: [],
    cacheDeletes: [],
  }
  const events = []

  const records = new Map([
    [WORKSPACE_ID, { path: CWD, title: '删除会话插件', sessionIds: [id, 'session-keep-me'], createdAt: 1, updatedAt: 1 }],
  ])
  const state = {
    initialized: true,
    defaultWorkspaceId: WORKSPACE_ID,
    workspaceIds: [WORKSPACE_ID],
    archivedSessionIds: [id],
    pinnedSessionIds: [id],
  }
  const table = {
    keys: () => [...records.keys()],
    get: (key) => records.get(key),
    update: async (key, fn) => {
      const next = fn(records.get(key))
      records.set(key, next)
      calls.updates.push({ key, next })
      return next
    },
  }
  // Mirrors `WorkspaceEntity.detachSession` (`dsh-workspace/lib/index.js:148`):
  // it funnels through the registry's own write chain and mutates the record.
  const entityHandle = {
    detachSession: async (sessionId) => {
      const current = records.get(WORKSPACE_ID)
      calls.entityDetach.push(sessionId)
      records.set(WORKSPACE_ID, {
        ...current,
        sessionIds: current.sessionIds.filter((entry) => entry !== sessionId),
        updatedAt: new Date().toISOString(),
      })
    },
  }
  const registryService = registry
    ? {
      requireTable: () => table,
      requireState: () => state,
      setState: async (next) => {
        calls.state = next
      },
      get: entity ? (key) => (key === WORKSPACE_ID ? entityHandle : undefined) : undefined,
      unarchiveSession: primitives
        ? async (sessionId) => {
          calls.unarchive.push(sessionId)
          state.archivedSessionIds = state.archivedSessionIds.filter((entry) => entry !== sessionId)
        }
        : undefined,
      unpinSession: primitives
        ? async (sessionId) => {
          calls.unpin.push(sessionId)
          state.pinnedSessionIds = state.pinnedSessionIds.filter((entry) => entry !== sessionId)
        }
        : undefined,
      stopSessionActivity: async () => {
        calls.stop += 1
      },
      sessionKnown: (sessionId) => sessionId === id,
      readSessionHeader: (sessionId) => (sessionId === id ? { id, cwd: CWD } : undefined),
      enqueueOperation: (operation) => operation(),
    }
    : undefined

  const liveSession = { id, header: { cwd: CWD } }
  const sessionsService = {
    get: (sessionId) => (sessionId === id && live ? liveSession : undefined),
    liveEntryFor: (session) => ({ id: session.id, announced: true }),
    flush: async () => {
      calls.flush += 1
    },
    detachEntered: async () => {
      calls.detach += 1
      if (detachFails) throw new Error('detach exploded')
    },
  }

  const storageDomainService = storageDomain
    ? {
      get: (name) => (name === 'session_projcache'
        ? {
          table: (tableName) => (tableName === 'sessions'
            ? {
              delete: async (sessionId) => {
                calls.cacheDeletes.push(sessionId)
                if (cacheFile !== undefined) await rm(cacheFile, { force: true })
                return true
              },
            }
            : { delete: async () => false }),
        }
        : undefined),
    }
    : undefined

  const services = {
    sessions: sessionsService,
    workspaceRegistry: registryService,
    storageDomain: storageDomainService,
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get: (name) => services[name],
    emit: (event, ...args) => {
      if (emitFails) throw new Error('emit exploded')
      events.push({ event, args })
    },
    waterfall: async () => activity,
    parallel: async () => {},
    inject: (names, callback) => {
      calls.injected.push(names)
      callback(ctx)
    },
    effect: (callback) => {
      calls.effects += 1
      return callback()
    },
  }

  return { ctx, calls, events, records, state, sessionsService }
}

/** Invoke an HTTP handler with a fake req/res pair. */
async function callHandler(handler, { method = 'POST', url, body, headers = {}, token }) {
  const req = {
    method,
    url,
    // The real client POSTs JSON plus the per-boot token it read from
    // `/health` (`lib/client.js` — `postHost`/`requestToken`); the request guard
    // requires both on state-changing routes.
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(typeof token === 'string' ? { 'x-session-delete-token': token } : {}),
      ...headers,
    },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
    // Over a real socket `req.destroy()` after `res.end()` races the response
    // out of the client's hands (measured ECONNRESET instead of a readable 413),
    // so the handler must drain with `resume()` and close politely instead.
    resumeCalled: false,
    destroyCalled: false,
    resume() {
      this.resumeCalled = true
    },
    destroy() {
      this.destroyCalled = true
    },
  }
  const res = {
    statusCode: 0,
    headers: {},
    payload: undefined,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(chunk) {
      this.payload = chunk === undefined ? undefined : JSON.parse(chunk)
    },
  }
  await handler(req, res)
  res.req = req
  return res
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('isDeletableSessionId rejects traversal and empty ids', () => {
  assert.equal(isDeletableSessionId(SESSION_ID), true)
  assert.equal(isDeletableSessionId('sub-agent_123'), true)
  assert.equal(isDeletableSessionId(''), false)
  assert.equal(isDeletableSessionId('.'), false)
  assert.equal(isDeletableSessionId('..'), false)
  assert.equal(isDeletableSessionId('../evil'), false)
  assert.equal(isDeletableSessionId('a/b'), false)
  assert.equal(isDeletableSessionId(undefined), false)
  assert.equal(isDeletableSessionId('-leading-dash'), false)
})

test('happy path: all seven stages run, disk + ledger + archive set + memory are cleaned', async () => {
  const { home, dir, cacheFile, workspaceFile } = await makeHome()
  const { ctx, calls, events, records, state } = makeCtx({ live: true })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  assert.deepEqual(report.stages.map((stage) => stage.key), [
    'validate', 'running-guard', 'workspace-ledger', 'archive-set', 'disk-logs', 'memory', 'broadcast',
  ])
  assert.deepEqual(report.stages.map((stage) => stage.status), [
    'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok',
  ])
  assert.equal(report.deleted, true)
  assert.equal(report.aborted, false)
  assert.deepEqual(report.warnings, [])

  // workspace-ledger used the registry's own entity mutator, not a raw table
  // write, and kept the other session in the record.
  assert.deepEqual(calls.entityDetach, [SESSION_ID])
  assert.equal(calls.updates.length, 0)
  assert.deepEqual(records.get(WORKSPACE_ID).sessionIds, ['session-keep-me'])
  // archive-set used the registry's idempotent primitives, not setState.
  assert.deepEqual(calls.unarchive, [SESSION_ID])
  assert.deepEqual(calls.unpin, [SESSION_ID])
  assert.equal(calls.state, null)
  assert.deepEqual(state.archivedSessionIds, [])
  assert.deepEqual(state.pinnedSessionIds, [])

  // disk-logs removed the session directory and the projection cache entry.
  assert.equal(await exists(dir), false)
  assert.equal(await exists(cacheFile), false)

  // memory detached the live entry (after a flush).
  assert.equal(calls.flush, 1)
  assert.equal(calls.detach, 1)

  // broadcast emitted the client-facing removal with the bare id.
  assert.deepEqual(events, [{ event: 'api-session/removed', args: [SESSION_ID] }])

  // the ledger file itself is untouched on the registry path (the registry owns it)
  const ledger = JSON.parse(await readFile(workspaceFile, 'utf8'))
  assert.deepEqual(ledger.global.archivedSessionIds, [SESSION_ID])
  await rm(home, { recursive: true, force: true })
})

test('no registry service: the workspace ledger file is edited atomically instead', async () => {
  const { home, dir, workspaceFile } = await makeHome()
  const { ctx } = makeCtx({ registry: false })
  const { deleteSession, runtime } = createSessionDeleter(ctx, { dshHome: home })

  assert.equal(runtime.paths.ledgerFile, workspaceFile)
  const report = await deleteSession(SESSION_ID)

  assert.equal(report.deleted, true)
  const ledger = JSON.parse(await readFile(workspaceFile, 'utf8'))
  assert.deepEqual(ledger.tables.workspaces[WORKSPACE_ID].sessionIds, ['session-keep-me'])
  assert.deepEqual(ledger.global.archivedSessionIds, [])
  assert.deepEqual(ledger.global.pinnedSessionIds, [])
  assert.equal(await exists(dir), false)
  // the temporary file never survives the atomic rename
  assert.equal(await exists(`${workspaceFile}.session-delete-${process.pid}.tmp`), false)
  await rm(home, { recursive: true, force: true })
})

test('registry without an entity handle falls back to a direct table write', async () => {
  const { home } = await makeHome()
  const { ctx, calls } = makeCtx({ entity: false })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID, { clock: () => 1_700_000_000_000 })

  assert.equal(report.deleted, true)
  assert.equal(calls.entityDetach.length, 0)
  assert.equal(calls.updates.length, 1)
  assert.deepEqual(calls.updates[0].next.sessionIds, ['session-keep-me'])
  // the record schema is `updatedAt: z.string()`, so the raw clock number from
  // the stage must be normalised — a number would be rejected by the domain.
  assert.equal(calls.updates[0].next.updatedAt, new Date(1_700_000_000_000).toISOString())
  await rm(home, { recursive: true, force: true })
})

test('archive set falls back to setState when the registry lacks the primitives', async () => {
  const { home } = await makeHome()
  const { ctx, calls } = makeCtx({ primitives: false })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  assert.equal(report.deleted, true)
  assert.deepEqual(calls.unarchive, [])
  assert.deepEqual(calls.unpin, [])
  assert.notEqual(calls.state, null)
  assert.deepEqual(calls.state.archivedSessionIds, [])
  assert.deepEqual(calls.state.pinnedSessionIds, [])
  // unrelated registry state survives the patch
  assert.deepEqual(calls.state.workspaceIds, [WORKSPACE_ID])
  assert.equal(calls.state.initialized, true)
  await rm(home, { recursive: true, force: true })
})

test('projection cache goes through the mounted storage domain, not a raw unlink', async () => {
  const { home, cacheFile } = await makeHome()
  const { ctx, calls } = makeCtx({ live: true, storageDomain: true, cacheFile })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  assert.equal(report.deleted, true)
  // twice on purpose: the disk stage drops the record, and the memory stage
  // sweeps again because disposing a live session rewrites the snapshot
  assert.deepEqual(calls.cacheDeletes, [SESSION_ID, SESSION_ID])
  assert.equal(await exists(cacheFile), false)
  const disk = report.stages.find((stage) => stage.key === 'disk-logs')
  assert.equal(disk.extra.cacheVia, 'domain')
  await rm(home, { recursive: true, force: true })
})

test('the file ledger path stamps an ISO updatedAt from a numeric clock', async () => {
  const { home, workspaceFile } = await makeHome()
  const { ctx } = makeCtx({ registry: false })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const stamp = 1_700_000_000_000
  const report = await deleteSession(SESSION_ID, { clock: () => stamp })

  assert.equal(report.deleted, true)
  const ledger = JSON.parse(await readFile(workspaceFile, 'utf8'))
  const record = ledger.tables.workspaces[WORKSPACE_ID]
  assert.deepEqual(record.sessionIds, ['session-keep-me'])
  assert.equal(record.updatedAt, new Date(stamp).toISOString())
  await rm(home, { recursive: true, force: true })
})

test('validate gate refuses a path-traversal id and mutates nothing', async () => {
  const { home, dir, cacheFile } = await makeHome()
  const { ctx, calls, events } = makeCtx({ live: true })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession('../evil')

  assert.equal(report.refused, true)
  assert.equal(report.aborted, true)
  assert.equal(report.deleted, false)
  assert.equal(report.stages.length, 1)
  assert.equal(report.stages[0].key, 'validate')
  assert.match(report.stages[0].detail, /非法字符/)
  assert.equal(await exists(dir), true)
  assert.equal(await exists(cacheFile), true)
  assert.equal(calls.detach, 0)
  assert.deepEqual(events, [])
  await rm(home, { recursive: true, force: true })
})

test('validate gate refuses an unknown session', async () => {
  const { home, dir } = await makeHome()
  const { ctx } = makeCtx({ live: false, registry: false })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession('session-99999999-0000-0000-0000-000000000000')

  assert.equal(report.refused, true)
  assert.match(report.stages[0].detail, /没有该会话/)
  assert.equal(await exists(dir), true)
  await rm(home, { recursive: true, force: true })
})

test('running guard: a busy session is refused without force and deleted with force', async () => {
  const busy = [{ kind: 'turn' }]

  {
    const { home, dir } = await makeHome()
    const { ctx, calls, events } = makeCtx({ live: true, activity: busy })
    const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

    const report = await deleteSession(SESSION_ID)

    assert.equal(report.refused, true)
    assert.equal(report.deleted, false)
    assert.equal(report.stages.length, 2)
    assert.equal(report.stages[1].key, 'running-guard')
    assert.match(report.stages[1].detail, /正在运行中/)
    assert.equal(calls.stop, 0)
    assert.equal(calls.detach, 0)
    assert.equal(await exists(dir), true)
    assert.deepEqual(events, [])
    await rm(home, { recursive: true, force: true })
  }

  {
    const { home, dir } = await makeHome()
    const { ctx, calls } = makeCtx({ live: true, activity: busy })
    const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

    const report = await deleteSession(SESSION_ID, { force: true })

    assert.equal(report.deleted, true)
    assert.equal(calls.stop, 1)
    assert.equal(calls.detach, 1)
    assert.equal(await exists(dir), false)
    await rm(home, { recursive: true, force: true })
  }
})

test('force is disabled by config: the guard still refuses', async () => {
  const { home } = await makeHome()
  const { ctx, calls } = makeCtx({ live: true, activity: [{ kind: 'turn' }] })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home, allowForce: false })

  const report = await deleteSession(SESSION_ID, { force: true })

  assert.equal(report.refused, true)
  assert.equal(calls.stop, 0)
  await rm(home, { recursive: true, force: true })
})

test('stages fail independently: a broken memory stage cannot undo the disk deletion', async () => {
  const { home, dir, cacheFile } = await makeHome()
  const { ctx, events } = makeCtx({ live: true, detachFails: true })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  const memory = report.stages.find((stage) => stage.key === 'memory')
  assert.equal(memory.status, 'failed')
  assert.match(memory.error.message, /detach exploded/)
  assert.equal(report.warnings.length, 1)
  // the disk and the ledger are already gone; the row is still broadcast
  assert.equal(await exists(dir), false)
  assert.equal(await exists(cacheFile), false)
  assert.equal(report.deleted, true)
  assert.deepEqual(events, [{ event: 'api-session/removed', args: [SESSION_ID] }])
  await rm(home, { recursive: true, force: true })
})

test('a session with no on-disk trace still deletes cleanly', async () => {
  const { home, dir } = await makeHome()
  await rm(dir, { recursive: true, force: true })
  const { ctx } = makeCtx({ live: false })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  assert.equal(report.deleted, true)
  const disk = report.stages.find((stage) => stage.key === 'disk-logs')
  assert.match(disk.detail, /没有该会话的日志目录/)
  await rm(home, { recursive: true, force: true })
})

test('preview reports disk usage, ledger state and running activity', async () => {
  const { home } = await makeHome()
  const { ctx } = makeCtx({ live: true, activity: [{ kind: 'turn' }] })
  const { runtime } = createSessionDeleter(ctx, { dshHome: home })

  const preview = await runtime.preview(SESSION_ID)

  assert.equal(preview.valid, true)
  assert.equal(preview.known, true)
  assert.equal(preview.live, true)
  assert.equal(preview.cwd, CWD)
  assert.equal(preview.totalFiles, 2)
  assert.equal(preview.totalBytes, 4)
  assert.equal(preview.activity.length, 1)
  assert.equal(preview.archived, true)
  assert.equal(preview.pinned, true)
  assert.deepEqual(preview.workspaces.map((workspace) => workspace.workspaceId), [WORKSPACE_ID])
  assert.equal(preview.registryAvailable, true)
  assert.equal(preview.forceAllowed, true)
  await rm(home, { recursive: true, force: true })
})

test('http: health, preview, delete, method and route guards', async () => {
  const { home, dir } = await makeHome()
  const { ctx, events } = makeCtx({ live: true })
  const deleter = createSessionDeleter(ctx, { dshHome: home })
  const call = (options) => callHandler(deleter.handler, { token: deleter.token, ...options })

  const health = await call({ method: 'GET', url: '/session-delete/health' })
  assert.equal(health.statusCode, 200)
  assert.equal(health.payload.ok, true)
  assert.equal(health.payload.value.name, 'dsh-session-delete')
  assert.equal(health.payload.value.token, deleter.token)

  const preview = await call({
    method: 'POST',
    url: '/session-delete/preview',
    body: { sessionId: SESSION_ID },
  })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.payload.value.sessionId, SESSION_ID)

  const badPreview = await call({
    method: 'POST',
    url: '/session-delete/preview',
    body: { sessionId: '../evil' },
  })
  assert.equal(badPreview.statusCode, 400)
  assert.equal(badPreview.payload.error.code, 'invalid-session-id')

  const wrongMethod = await call({ method: 'GET', url: '/session-delete/delete' })
  assert.equal(wrongMethod.statusCode, 405)

  const badJson = await call({
    method: 'POST',
    url: '/session-delete/delete',
    body: 'not json',
  })
  // a malformed body is the caller's fault: 4xx, never 500
  assert.equal(badJson.statusCode, 400)
  assert.equal(badJson.payload.error.code, 'invalid-json')

  const denied = await call({
    method: 'POST',
    url: '/session-delete/delete',
    body: { sessionId: '../evil' },
  })
  assert.equal(denied.statusCode, 400)

  const missing = await call({ method: 'GET', url: '/session-delete/nope' })
  assert.equal(missing.statusCode, 404)

  const deleted = await call({
    method: 'POST',
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
  })
  assert.equal(deleted.statusCode, 200)
  assert.equal(deleted.payload.ok, true)
  assert.equal(deleted.payload.value.deleted, true)
  assert.equal(await exists(dir), false)
  assert.equal(events.length, 1)

  await rm(home, { recursive: true, force: true })
})

test('http: the per-boot token is required on POSTs and blocks blind deletes', async () => {
  const { home, dir } = await makeHome()
  const { ctx, calls } = makeCtx({ live: true })
  const deleter = createSessionDeleter(ctx, { dshHome: home })
  assert.equal(typeof deleter.token, 'string')
  assert.ok(deleter.token.length >= 8)

  // no token: a blind cross-site POST (which may carry neither origin nor
  // sec-fetch-site) still cannot delete anything
  const blind = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
  })
  assert.equal(blind.statusCode, 403)
  assert.equal(blind.payload.error.code, 'invalid-token')
  assert.equal(await exists(dir), true)

  const wrong = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token: 'not-the-token',
  })
  assert.equal(wrong.statusCode, 403)
  assert.equal(wrong.payload.error.code, 'invalid-token')
  assert.equal(await exists(dir), true)

  // the preview route is token-guarded too (it discloses cwd and disk usage)
  const preview = await callHandler(deleter.handler, {
    url: '/session-delete/preview',
    body: { sessionId: SESSION_ID },
  })
  assert.equal(preview.statusCode, 403)

  const allowed = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token: deleter.token,
  })
  assert.equal(allowed.statusCode, 200)
  assert.equal(allowed.payload.value.deleted, true)
  assert.equal(calls.detach, 1)

  // opting out must be explicit, and only then is an untokened POST accepted
  const open = createSessionDeleter(ctx, { dshHome: home, requireToken: false })
  assert.equal(open.token, null)
  const health = await callHandler(open.handler, { method: 'GET', url: '/session-delete/health' })
  assert.equal(health.payload.value.requireToken, false)
  assert.equal(health.payload.value.token, undefined)

  await rm(home, { recursive: true, force: true })
})

test('http: a busy session answers 409 and keeps the report in value', async () => {
  const { home, dir } = await makeHome()
  const { ctx } = makeCtx({ live: true, activity: [{ kind: 'turn' }] })
  const deleter = createSessionDeleter(ctx, { dshHome: home })

  const response = await callHandler(deleter.handler, {
    method: 'POST',
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token: deleter.token,
  })

  assert.equal(response.statusCode, 409)
  assert.equal(response.payload.ok, false)
  assert.equal(response.payload.value.refused, true)
  assert.equal(await exists(dir), true)
  await rm(home, { recursive: true, force: true })
})

test('http: cross-site and non-JSON delete requests are refused before any mutation', async () => {
  const { home, dir } = await makeHome()
  const { ctx, calls } = makeCtx({ live: true })
  const deleter = createSessionDeleter(ctx, { dshHome: home })
  const token = deleter.token

  // the origin checks run before the token check, so a cross-site caller is
  // rejected even when it somehow learned the token
  const crossSite = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token,
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSite.statusCode, 403)
  assert.equal(crossSite.payload.error.code, 'cross-site-blocked')

  const crossOrigin = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token,
    headers: { origin: 'https://evil.example', host: '127.0.0.1:19387' },
  })
  assert.equal(crossOrigin.statusCode, 403)
  assert.equal(crossOrigin.payload.error.code, 'cross-origin-blocked')

  // a browser "simple request" (text/plain) never triggers a preflight, so the
  // content-type requirement is what keeps it out
  const formPost = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: JSON.stringify({ sessionId: SESSION_ID }),
    token,
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(formPost.statusCode, 415)
  assert.equal(formPost.payload.error.code, 'unsupported-media-type')

  // `application/jsonp` is also a no-preflight simple request: the media-type
  // gate must be a strict match, not a substring search (audit finding)
  const jsonp = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: JSON.stringify({ sessionId: SESSION_ID }),
    token,
    headers: { 'content-type': 'application/jsonp' },
  })
  assert.equal(jsonp.statusCode, 415)
  assert.equal(jsonp.payload.error.code, 'unsupported-media-type')

  assert.equal(await exists(dir), true)
  assert.equal(calls.detach, 0)
  assert.deepEqual(calls.entityDetach, [])

  // the legitimate same-origin browser call (JSON + token) still goes through,
  // including a parameterised media type
  const allowed = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    token,
    headers: {
      origin: 'http://127.0.0.1:19387',
      host: '127.0.0.1:19387',
      'content-type': 'application/json; charset=utf-8',
    },
  })
  assert.equal(allowed.statusCode, 200)
  assert.equal(allowed.payload.value.deleted, true)
  await rm(home, { recursive: true, force: true })
})

test('http: health discloses nothing but the token and oversized bodies are refused', async () => {
  const { home } = await makeHome()
  const { ctx } = makeCtx({ live: true })
  const deleter = createSessionDeleter(ctx, { dshHome: home })

  const health = await callHandler(deleter.handler, { method: 'GET', url: '/session-delete/health' })
  const value = health.payload.value
  assert.deepEqual(Object.keys(value).sort(), ['name', 'requireToken', 'token', 'version'])
  assert.equal(value.home, undefined)
  assert.equal(value.sessionsRoot, undefined)
  assert.equal(value.ledgerFile, undefined)

  const huge = JSON.stringify({ sessionId: SESSION_ID, pad: 'x'.repeat(300 * 1024) })
  const oversize = await callHandler(deleter.handler, {
    url: '/session-delete/delete',
    body: huge,
    token: deleter.token,
  })
  assert.equal(oversize.statusCode, 413)
  assert.equal(oversize.payload.error.code, 'body-too-large')
  // the 413 must survive to the peer: drain the remaining upload, never destroy
  // the socket, and close the connection after the response instead
  assert.equal(oversize.headers.connection, 'close')
  assert.equal(oversize.req.resumeCalled, true)
  assert.equal(oversize.req.destroyCalled, false)

  await rm(home, { recursive: true, force: true })
})

test('apply() mounts the route behind the webServer capability', async () => {
  const { home } = await makeHome()
  const { ctx, calls } = makeCtx({ live: false })
  const registered = []
  ctx.webServer = undefined
  const { apply } = await import('../lib/index.js')

  const webCtx = {
    ...ctx,
    webServer: {
      register: (options) => {
        registered.push(options)
        return () => {}
      },
    },
  }
  webCtx.inject = (names, callback) => {
    calls.injected.push(names)
    callback(webCtx)
  }

  apply(webCtx, { dshHome: home })

  assert.deepEqual(calls.injected, [['webServer']])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/session-delete')
  assert.equal(typeof registered[0].handler, 'function')
  assert.equal(calls.effects, 1)
  await rm(home, { recursive: true, force: true })
})

/**
 * A fake runtime for stage-level tests: the pipeline's behaviour when the disk
 * cannot be cleaned is decided in `stages.js`, so it is exercised directly.
 */
function stageRuntime(overrides = {}) {
  const calls = { broadcasts: [], removals: 0 }
  const runtime = {
    paths: { ledgerFile: 'unused.json' },
    diskTargets: async () => ({ dirs: [{ path: 'C:/tmp/locked', bytes: 4, files: 2 }], scanned: 1, cwds: [] }),
    removeDisk: async () => {
      calls.removals += 1
      return {
        removed: [],
        failed: [{ path: 'C:/tmp/locked', error: { message: 'EBUSY: resource busy or locked' } }],
        cache: { removed: [], via: 'file' },
      }
    },
    detachFromMemory: async () => ({ status: 'ok', detail: '已从运行态存储摘除' }),
    broadcastRemoved: (sessionId) => {
      calls.broadcasts.push(sessionId)
      return { status: 'ok', detail: '已广播' }
    },
    ...overrides,
  }
  return { runtime, calls }
}

test('a failed disk stage suppresses the removal broadcast instead of hiding a live row', async () => {
  const { runtime, calls } = stageRuntime()
  const stages = createStages(runtime)
  const shared = { sessionId: 'session-locked', clock: () => 0, logger: () => {} }

  const disk = await stages['disk-logs'](shared)
  assert.equal(disk.status, 'failed')
  assert.match(disk.detail, /EBUSY/)
  assert.deepEqual(shared.leftoverDiskPaths, ['C:/tmp/locked'])

  const broadcast = await stages.broadcast(shared)
  assert.equal(broadcast.status, 'blocked', 'the row must not vanish while its logs survive')
  assert.deepEqual(calls.broadcasts, [], 'no removal event may be emitted')
})

test('a memory-stage retry that clears the leftovers re-enables the broadcast', async () => {
  let attempt = 0
  const { runtime, calls } = stageRuntime({
    removeDisk: async () => {
      attempt += 1
      if (attempt === 1) {
        return {
          removed: [],
          failed: [{ path: 'C:/tmp/locked', error: { message: 'EBUSY: resource busy or locked' } }],
          cache: { removed: [], via: 'file' },
        }
      }
      return {
        removed: [{ dir: 'C:/tmp/locked', summary: { bytes: 4 } }],
        failed: [],
        cache: { removed: [], via: 'file' },
      }
    },
  })
  const stages = createStages(runtime)
  const shared = { sessionId: 'session-locked', clock: () => 0, logger: () => {} }

  await stages['disk-logs'](shared)
  const memory = await stages.memory(shared)
  assert.equal(memory.status, 'ok')
  assert.deepEqual(shared.leftoverDiskPaths, [])

  const broadcast = await stages.broadcast(shared)
  assert.equal(broadcast.status, 'ok')
  assert.deepEqual(calls.broadcasts, ['session-locked'])
})

test('the memory stage sweeps the projection cache again after the detach rewrote it', async () => {
  const order = []
  const { runtime } = stageRuntime({
    detachFromMemory: async () => {
      order.push('detach')
      return { status: 'ok', detail: '已从运行态存储摘除' }
    },
    sweepProjectionCache: async (sessionId) => {
      order.push(`sweep:${sessionId}`)
      return {
        via: 'domain+file',
        removed: ['C:/home/storages/session_projcache/sessions/session-locked.json'],
        failed: [],
      }
    },
  })
  const stages = createStages(runtime)
  const shared = { sessionId: 'session-locked', clock: () => 0, logger: () => {} }

  const memory = await stages.memory(shared)

  assert.equal(memory.status, 'ok')
  assert.deepEqual(order, ['detach', 'sweep:session-locked'], 'the sweep must follow the detach, never precede it')
  assert.match(memory.detail, /摘除后再次清理投影缓存 1 项/)
  assert.deepEqual(memory.extra.cacheSweep.removed, [
    'C:/home/storages/session_projcache/sessions/session-locked.json',
  ])
})

test('a projection-cache sweep that throws is reported without failing the memory stage', async () => {
  const { runtime } = stageRuntime({
    sweepProjectionCache: async () => {
      throw new Error('EBUSY: cache file is locked')
    },
  })
  const stages = createStages(runtime)
  const shared = { sessionId: 'session-locked', clock: () => 0, logger: () => {} }

  const memory = await stages.memory(shared)

  assert.equal(memory.status, 'ok', 'a stale cache file must not turn a clean detach into a failure')
  assert.equal(memory.extra.cacheSweep.failed[0].error.message, 'EBUSY: cache file is locked')
  assert.doesNotMatch(memory.detail, /再次清理/)
})

test('a host whose emit throws reports the broadcast stage as failed', async () => {
  const { home } = await makeHome()
  const { ctx } = makeCtx({ live: true, emitFails: true })
  const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })

  const report = await deleteSession(SESSION_ID)

  const broadcast = report.stages.find((stage) => stage.key === 'broadcast')
  assert.equal(broadcast.status, 'failed')
  assert.match(broadcast.detail, /emit exploded/)
  assert.equal(report.deleted, true, 'the disk and the ledger really are clean')
  assert.ok(
    report.warnings.some((warning) => warning.includes('广播事件')),
    'a non-throwing stage failure must still appear in warnings',
  )
  await rm(home, { recursive: true, force: true })
})

test('http: the trailing-slash alias deletes and stricter origin rules refuse opaque origins', async () => {
  const { home, dir } = await makeHome()
  const { ctx } = makeCtx({ live: true })
  const deleter = createSessionDeleter(ctx, { dshHome: home })
  const call = (options) => callHandler(deleter.handler, { token: deleter.token, ...options })

  const alias = await call({ url: '/session-delete/', body: { sessionId: SESSION_ID } })
  assert.equal(alias.statusCode, 200)
  assert.equal(alias.payload.value.deleted, true)
  assert.equal(await exists(dir), false)

  const getAlias = await call({ method: 'GET', url: '/session-delete/' })
  assert.equal(getAlias.statusCode, 405)

  const opaque = await call({
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    headers: { origin: 'null' },
  })
  assert.equal(opaque.statusCode, 403)
  assert.equal(opaque.payload.error.code, 'cross-origin-blocked')

  const padded = await call({
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    headers: { 'sec-fetch-site': '  cross-site  ' },
  })
  assert.equal(padded.payload.error.code, 'cross-site-blocked')

  const schemeMismatch = await call({
    url: '/session-delete/delete',
    body: { sessionId: SESSION_ID },
    headers: {
      origin: 'https://127.0.0.1:19387',
      host: '127.0.0.1:19387',
      'x-forwarded-proto': 'http',
    },
  })
  assert.equal(schemeMismatch.payload.error.code, 'cross-origin-blocked')

  const caseInsensitiveHost = await call({
    method: 'GET',
    url: '/session-delete/preview?sessionId=' + SESSION_ID,
    headers: { origin: 'http://LOCALHOST:19387', host: 'localhost:19387' },
  })
  assert.equal(caseInsensitiveHost.statusCode, 200, 'host comparison must ignore case')
  await rm(home, { recursive: true, force: true })
})

test('concurrent ledger-file edits lose no update and leave no temp files behind', async () => {
  const { home, workspaceFile } = await makeHome()
  const { ctx } = makeCtx({ registry: false })
  const { runtime } = createSessionDeleter(ctx, { dshHome: home })

  const seeded = JSON.parse(await readFile(workspaceFile, 'utf8'))
  const ids = ['session-a1', 'session-a2', 'session-a3', 'session-a4', 'session-a5']
  seeded.tables.workspaces[WORKSPACE_ID].sessionIds = [...ids, SESSION_ID]
  await writeFile(workspaceFile, JSON.stringify(seeded, null, 2), 'utf8')

  await Promise.all(ids.map((id) => runtime.removeFromWorkspaces(id, 1_700_000_000_000)))

  const after = JSON.parse(await readFile(workspaceFile, 'utf8'))
  assert.deepEqual(
    after.tables.workspaces[WORKSPACE_ID].sessionIds,
    [SESSION_ID],
    'every concurrent removal must survive: the file fallback is serialised in-process',
  )
  assert.equal(
    after.tables.workspaces[WORKSPACE_ID].updatedAt,
    new Date(1_700_000_000_000).toISOString(),
  )
  const strays = (await readdir(join(home, 'storages'))).filter((name) => name.includes('.tmp'))
  assert.deepEqual(strays, [], 'a unique temp name per writer must not leave orphans')
  await rm(home, { recursive: true, force: true })
})

/**
 * Storage relocated to another volume: the visible session directory is only a
 * link (junction) and the logs live behind it. `rm(link, { recursive: true })`
 * removes the link and keeps every log file, so without follow-the-link
 * handling the pipeline would report success while the logs survive.
 */
test('a session directory that is a link is deleted together with its payload', async (t) => {
  const { home, dir } = await makeHome()
  const payloadRoot = await mkdtemp(join(tmpdir(), 'session-delete-payload-'))
  const payload = join(payloadRoot, encodeSegment(SESSION_ID))
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  try {
    await mkdir(payload, { recursive: true })
    await rename(join(dir, 'session.v4.jsonl.zstd'), join(payload, 'session.v4.jsonl.zstd'))
    await rm(dir, { recursive: true, force: true })
    try {
      await symlink(payload, dir, linkType)
    } catch (error) {
      t.skip(`directory links unavailable here: ${error.message}`)
      return
    }

    const { ctx } = makeCtx({ registry: false })
    const { deleteSession, runtime } = createSessionDeleter(ctx, { dshHome: home })

    const targets = await runtime.diskTargets(SESSION_ID)
    assert.equal(targets.dirs[0]?.link, true, 'the preview flags the link so the dialog can warn')

    const report = await deleteSession(SESSION_ID, {})
    assert.equal(report.deleted, true)
    const disk = report.stages.find((stage) => stage.key === 'disk-logs')
    assert.equal(disk.status, 'ok')
    assert.equal(disk.extra.removed[0].viaLink, true, 'the report records that the link was followed')
    assert.equal(disk.extra.bytes, 4, 'the bytes reported are the real payload, not the link')

    await assert.rejects(() => stat(dir), 'the link itself is gone')
    await assert.rejects(
      () => stat(join(payload, 'session.v4.jsonl.zstd')),
      'the logs behind the link are gone too',
    )
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(payloadRoot, { recursive: true, force: true })
  }
})

test('a link to a directory without session storage fails loudly and keeps the row', async (t) => {
  const { home, dir } = await makeHome()
  const payloadRoot = await mkdtemp(join(tmpdir(), 'session-delete-unrelated-'))
  const unrelated = join(payloadRoot, 'unrelated-folder')
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  try {
    await mkdir(unrelated, { recursive: true })
    await writeFile(join(unrelated, 'keep.txt'), 'not mine')
    await rm(dir, { recursive: true, force: true })
    try {
      await symlink(unrelated, dir, linkType)
    } catch (error) {
      t.skip(`directory links unavailable here: ${error.message}`)
      return
    }

    const { ctx } = makeCtx({ registry: false })
    const { deleteSession } = createSessionDeleter(ctx, { dshHome: home })
    const report = await deleteSession(SESSION_ID, {})

    assert.equal(report.deleted, false, 'a delete that could not clear the logs is not a delete')
    const disk = report.stages.find((stage) => stage.key === 'disk-logs')
    assert.equal(disk.status, 'failed')
    assert.match(disk.detail, /不是会话存储/, 'the refusal explains itself instead of "[object Object]"')
    assert.equal(
      report.stages.find((stage) => stage.key === 'broadcast').status,
      'blocked',
      'the row must stay visible while the logs are still on disk',
    )
    assert.ok((await stat(join(unrelated, 'keep.txt'))).isFile(), 'the unrelated directory is untouched')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(payloadRoot, { recursive: true, force: true })
  }
})
