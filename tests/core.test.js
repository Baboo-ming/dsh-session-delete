/**
 * Unit tests for the dependency-free core (`lib/core/*`).
 *
 * Run with:  node --test tests
 *
 * Several `projectKey` expectations below are copied verbatim from live
 * directories under `C:\Users\ming\.dsh\sessions` (see the table in the test),
 * so the encoding port is pinned to real host output rather than to itself.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  encodeSegment,
  projectKey,
  projectDir,
  sessionDir,
  candidateSessionDirs,
} from '../lib/core/paths.js'
import {
  WORKSPACE_UNIT_NAME,
  WORKSPACE_UNIT_VERSION,
  validateLedger,
  workspacesForSession,
  knownProjectPaths,
  removeSessionFromWorkspaces,
  removeSessionFromGlobalSets,
  removeSessionFromLedger,
  ledgerHasSession,
} from '../lib/core/ledger.js'
import { STAGES, runDeletionPipeline, summarizeReport, describeError } from '../lib/core/pipeline.js'
import {
  SESSION_LOG_PATTERN,
  assertRemovable,
  findSessionDirs,
  describeDir,
  removeSessionDirs,
  projectionCacheCandidates,
  removeProjectionCache,
} from '../lib/core/scan.js'

const SESSION = 'session-e5594e8a-1e8e-4ab5-8b73-8a2487481e74'

/* ------------------------------------------------------------------ paths */

test('encodeSegment leaves session ids untouched', () => {
  assert.equal(encodeSegment(SESSION), SESSION)
  assert.equal(encodeSegment('sub-agent-01.2_x'), 'sub-agent-01.2_x')
})

test('encodeSegment escapes unsafe code units and tilde', () => {
  assert.equal(encodeSegment('开'), '~5F00')
  assert.equal(encodeSegment('~'), '~007E')
  assert.equal(encodeSegment('ab开cd'), 'ab~5F00cd')
  assert.equal(encodeSegment('a b'), 'a~0020b')
  assert.equal(encodeSegment('.hidden'), '.hidden')
})

test('encodeSegment special-cases traversal and rejects empties', () => {
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.throws(() => encodeSegment(''))
  assert.throws(() => encodeSegment(42))
})

test('projectKey reproduces live session-root directory names', () => {
  // name observed on disk  →  cwd recorded for those sessions
  const live = {
    '--C-Users-ming-Documents-deepseek-harness-default-workspace--':
      'C:\\Users\\ming\\Documents\\deepseek-harness\\default-workspace',
    '--D-AI_Work--': 'D:\\AI_Work',
    '--D-AI_Work-~4EFB~52A1-~6D4B~8BD5--': 'D:\\AI_Work\\任务\\测试',
    '--D-AI_Work-~4EFB~52A1-~6E17~900F--': 'D:\\AI_Work\\任务\\渗透',
    '--D-AI_Work-~4EFB~52A1-~6E17~900F-ck~5546~57CE--': 'D:\\AI_Work\\任务\\渗透\\ck商城',
    '--D-AI_Work-~521B~4F5C--': 'D:\\AI_Work\\创作',
    '--D-AI_Work-~5C0F~8BF4-a--': 'D:\\AI_Work\\小说\\a',
    '--D-AI_Work-~6D4B~8BD5--': 'D:\\AI_Work\\测试',
    '--D-AI_Work-~6D4B~8BD5-tes--': 'D:\\AI_Work\\测试\\tes',
    '--D-AI_Work-~90E8~7F72--': 'D:\\AI_Work\\部署',
  }
  for (const [name, cwd] of Object.entries(live)) {
    assert.equal(projectKey(cwd), name, `projectKey(${cwd})`)
  }
})

test('projectKey collapses separators, trims dashes and falls back to root', () => {
  assert.equal(projectKey('D:/AI_Work'), '--D-AI_Work--')
  assert.equal(projectKey('D::\\\\AI_Work'), '--D-AI_Work--')
  assert.equal(projectKey('///'), '--root--')
  assert.equal(projectKey(''), '--root--')
  assert.equal(projectKey('开').startsWith('--~5F00--'), true)
  assert.throws(() => projectKey(undefined))
})

test('projectKey truncates the readable part to 251 characters', () => {
  const key = projectKey(`D:\\${'a'.repeat(400)}`)
  assert.equal(key.length, 2 + 251 + 2)
})

test('projectDir / sessionDir / candidateSessionDirs', () => {
  const root = 'C:\\root'
  assert.equal(projectDir(root, 'D:\\AI_Work', join), join(root, '--D-AI_Work--'))
  assert.equal(projectDir(root, undefined, join), join(root, '_no-cwd'))
  assert.equal(
    sessionDir(root, 'D:\\AI_Work', SESSION, join),
    join(root, '--D-AI_Work--', SESSION),
  )
  const candidates = candidateSessionDirs(root, ['D:\\AI_Work', 'D:\\AI_Work', undefined], SESSION, join)
  assert.deepEqual(candidates, [
    join(root, '--D-AI_Work--', SESSION),
    join(root, '_no-cwd', SESSION),
  ])
})

/* ----------------------------------------------------------------- ledger */

function liveLedger() {
  return {
    unit: { name: WORKSPACE_UNIT_NAME, version: WORKSPACE_UNIT_VERSION },
    global: {
      initialized: true,
      defaultWorkspaceId: '230a398b-fa4e-451b-9f3b-b95d085dab0e',
      workspaceIds: ['38b23fb6-56d1-4b14-bfe3-3206066acd97', '6f3af497-de01-4684-9c33-6ad105c73d18'],
      archivedSessionIds: ['session-7782db9c-8119-4264-aaa3-98e6a13f3385'],
      pinnedSessionIds: [SESSION],
    },
    tables: {
      workspaces: {
        '38b23fb6-56d1-4b14-bfe3-3206066acd97': {
          path: 'D:\\AI_Work\\开发\\删除会话插件',
          title: '删除会话插件',
          sessionIds: [SESSION],
          createdAt: '2026-10-09T01:46:56.125Z',
          updatedAt: '2026-10-09T01:46:56.208Z',
        },
        '6f3af497-de01-4684-9c33-6ad105c73d18': {
          path: 'D:\\AI_Work\\创作',
          title: '创作',
          sessionIds: ['session-8ca87de9-370f-4cf8-b092-97003b0412ab', SESSION],
          createdAt: '2026-10-01T13:32:08.757Z',
          updatedAt: '2026-10-09T01:35:18.673Z',
        },
      },
    },
  }
}

test('validateLedger accepts live shape and rejects malformed ones', () => {
  assert.equal(validateLedger(liveLedger()).ok, true)
  assert.equal(validateLedger(null).ok, false)
  assert.equal(validateLedger([]).ok, false)
  assert.equal(validateLedger({}).ok, false)
  assert.equal(validateLedger({ global: {} }).ok, false)
  assert.equal(validateLedger({ global: { archivedSessionIds: 'x' } }).ok, false)
  assert.equal(validateLedger({ global: { archivedSessionIds: [] }, tables: [] }).ok, false)
  assert.equal(
    validateLedger({ global: { archivedSessionIds: [] }, tables: { workspaces: [] } }).ok,
    false,
  )
})

test('workspacesForSession and knownProjectPaths read the ledger', () => {
  const ledger = liveLedger()
  assert.deepEqual(
    workspacesForSession(ledger, SESSION).map((entry) => entry.workspaceId),
    ['38b23fb6-56d1-4b14-bfe3-3206066acd97', '6f3af497-de01-4684-9c33-6ad105c73d18'],
  )
  assert.deepEqual(knownProjectPaths(ledger), ['D:\\AI_Work\\开发\\删除会话插件', 'D:\\AI_Work\\创作'])
  assert.equal(ledgerHasSession(ledger, SESSION), true)
  assert.equal(ledgerHasSession(ledger, 'session-nope'), false)
})

test('removeSessionFromWorkspaces drops every accounting entry', () => {
  const ledger = liveLedger()
  const report = removeSessionFromWorkspaces(ledger, SESSION, '2026-10-09T02:00:00.000Z')
  assert.equal(report.touched, 2)
  assert.equal(ledgerHasSession(ledger, SESSION), true, 'still pinned at this point')
  assert.deepEqual(ledger.tables.workspaces['38b23fb6-56d1-4b14-bfe3-3206066acd97'].sessionIds, [])
  assert.equal(
    ledger.tables.workspaces['6f3af497-de01-4684-9c33-6ad105c73d18'].sessionIds.length,
    1,
  )
  assert.equal(
    ledger.tables.workspaces['38b23fb6-56d1-4b14-bfe3-3206066acd97'].updatedAt,
    '2026-10-09T02:00:00.000Z',
  )
})

test('removeSessionFromWorkspaces drops every occurrence of a duplicated id', () => {
  const ledger = liveLedger()
  const key = '38b23fb6-56d1-4b14-bfe3-3206066acd97'
  // an older/buggy host build can list the same id twice; leaving one behind
  // keeps `ledgerHasSession` true and the row comes back after a reload
  ledger.tables.workspaces[key].sessionIds = [SESSION, SESSION]
  const report = removeSessionFromWorkspaces(ledger, SESSION, '2026-10-09T02:00:00.000Z')

  assert.deepEqual(ledger.tables.workspaces[key].sessionIds, [])
  assert.equal(report.removed[0].count, 2)
  assert.equal(ledgerHasSession(ledger, SESSION), true, 'still pinned in the global set at this point')
  const global = removeSessionFromGlobalSets(ledger, SESSION)
  assert.deepEqual(global, { archived: false, pinned: true })
  assert.equal(ledgerHasSession(ledger, SESSION), false)
})

test('removeSessionFromGlobalSets prunes archived and pinned', () => {
  const ledger = liveLedger()
  ledger.global.archivedSessionIds.push(SESSION)
  const report = removeSessionFromGlobalSets(ledger, SESSION)
  assert.deepEqual(report, { archived: true, pinned: true })
  assert.deepEqual(ledger.global.archivedSessionIds, ['session-7782db9c-8119-4264-aaa3-98e6a13f3385'])
  assert.deepEqual(ledger.global.pinnedSessionIds, [])
})

test('removeSessionFromLedger is complete and idempotent', () => {
  const ledger = liveLedger()
  const first = removeSessionFromLedger(ledger, SESSION, '2026-10-09T02:00:00.000Z')
  assert.equal(first.changed, true)
  assert.equal(first.archived, false)
  assert.equal(first.pinned, true)
  assert.equal(first.workspaces.length, 2)
  assert.equal(first.invalid, undefined)
  assert.equal(ledgerHasSession(ledger, SESSION), false)

  const second = removeSessionFromLedger(ledger, SESSION)
  assert.deepEqual(second, { workspaces: [], archived: false, pinned: false, changed: false })
})

test('removeSessionFromLedger degrades on an invalid ledger instead of throwing', () => {
  const report = removeSessionFromLedger({ nonsense: true }, SESSION)
  assert.equal(report.changed, false)
  assert.ok(report.invalid)
})

/* --------------------------------------------------------------- pipeline */

function stages(overrides = {}) {
  const ok = async () => ({ status: 'ok' })
  return {
    validate: ok,
    'running-guard': ok,
    'workspace-ledger': ok,
    'archive-set': ok,
    'disk-logs': ok,
    memory: ok,
    broadcast: ok,
    ...overrides,
  }
}

test('STAGES is the frozen seven-stage contract in order', () => {
  assert.deepEqual(STAGES.map((stage) => stage.key), [
    'validate',
    'running-guard',
    'workspace-ledger',
    'archive-set',
    'disk-logs',
    'memory',
    'broadcast',
  ])
  assert.deepEqual(STAGES.map((stage) => stage.label), [
    '校验 ID',
    '运行保护',
    '工作区挂账移除',
    '归档集合清理',
    '磁盘日志删除',
    '内存摘除',
    '广播事件',
  ])
  assert.equal(Object.isFrozen(STAGES), true)
})

test('happy path deletes and reports every stage', async () => {
  const report = await runDeletionPipeline({ sessionId: SESSION, stages: stages() })
  assert.equal(report.deleted, true)
  assert.equal(report.partial, false)
  assert.equal(report.aborted, false)
  assert.equal(report.stages.length, 7)
  assert.deepEqual(report.stages.map((entry) => entry.status), Array(7).fill('ok'))
  assert.equal(report.sessionId, SESSION)
})

test('a failing non-gate stage degrades but the pipeline continues', async () => {
  const seen = []
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      'archive-set': async () => {
        throw new Error('storage offline')
      },
      memory: async () => {
        seen.push('memory')
        return { status: 'ok' }
      },
    }),
  })
  assert.deepEqual(seen, ['memory'], 'later stages still run')
  assert.equal(report.stages.length, 7)
  assert.equal(report.stages.find((entry) => entry.key === 'archive-set').status, 'failed')
  assert.equal(report.stages.find((entry) => entry.key === 'archive-set').error.message, 'storage offline')
  assert.equal(report.warnings.length, 1)
  assert.equal(report.deleted, true)
})

test('disk failure means "not deleted" even when other stages succeed', async () => {
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      'disk-logs': async () => {
        throw new Error('EBUSY')
      },
    }),
  })
  assert.equal(report.deleted, false)
  assert.equal(report.partial, true)
  assert.match(summarizeReport(report), /删除未完成（降级：磁盘日志删除）/)
})

test('a blocked non-gate stage is named in the summary, not silently dropped', async () => {
  // The realistic case: the disk stage failed, so the broadcast stage returns
  // `blocked` on purpose (hiding the row while the log survives would make the
  // session reappear after a restart). A summary-only consumer must be able to
  // see that the removal event was suppressed.
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      'disk-logs': async () => ({ status: 'failed', detail: 'EBUSY' }),
      broadcast: async () => ({ status: 'blocked', detail: '磁盘日志未清干净，已抑制广播' }),
    }),
  })
  assert.equal(report.aborted, false, 'a non-gate block is not an abort')
  assert.equal(report.deleted, false)
  const summary = summarizeReport(report)
  assert.match(summary, /降级：磁盘日志删除/)
  assert.match(summary, /阻断：广播事件/)
})

test('a gate veto aborts before any mutation', async () => {
  const touched = []
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      validate: async () => {
        touched.push('validate')
        return { status: 'ok' }
      },
      'running-guard': async () => ({ abort: true, reason: '会话正在运行，已拒绝删除' }),
      'workspace-ledger': async () => {
        touched.push('workspace-ledger')
      },
    }),
  })
  assert.deepEqual(touched, ['validate'])
  assert.equal(report.aborted, true)
  assert.equal(report.refused, true)
  assert.equal(report.deleted, false)
  assert.equal(report.stages.length, 2)
  assert.equal(report.stages[1].status, 'blocked')
  assert.equal(report.stages[1].detail, '会话正在运行，已拒绝删除')
  assert.equal(summarizeReport(report), '已中止：未删除任何数据')
})

test('a gate that throws refuses deletion instead of continuing', async () => {
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      validate: async () => {
        throw new Error('bad id')
      },
    }),
  })
  assert.equal(report.refused, true)
  assert.equal(report.aborted, true)
  assert.equal(report.stages.length, 1)
})

test('missing stages are skipped, never fatal', async () => {
  const report = await runDeletionPipeline({ sessionId: SESSION, stages: {} })
  assert.equal(report.stages.length, 7)
  assert.deepEqual(report.stages.map((entry) => entry.status), Array(7).fill('skipped'))
  assert.equal(report.deleted, true)
  assert.match(report.stages[0].detail, /阶段未装配/)
})

test('stage timing and detail are recorded', async () => {
  let now = 100
  const report = await runDeletionPipeline({
    sessionId: SESSION,
    stages: stages({
      validate: async () => {
        now += 25
        return { status: 'ok', detail: 'ID 合法' }
      },
    }),
    clock: () => now,
  })
  assert.equal(report.stages[0].ms, 25)
  assert.equal(report.stages[0].detail, 'ID 合法')
})

test('the pipeline never throws, even on absurd input', async () => {
  const report = await runDeletionPipeline({
    sessionId: undefined,
    stages: {
      validate: async () => {
        throw 'not even an Error'
      },
    },
  })
  assert.equal(report.aborted, true)
  assert.equal(report.stages[0].error.message, 'not even an Error')
  const nested = await runDeletionPipeline({})
  assert.equal(nested.stages.length, 7)
  assert.equal(describeError(new Error('x')).message, 'x')
})

test('stages see the shared context and the growing report', async () => {
  let observedSession
  let observedReportLength
  await runDeletionPipeline({
    sessionId: SESSION,
    context: { services: { marker: true }, cwd: 'D:\\AI_Work' },
    stages: stages({
      memory: async (context) => {
        observedSession = context.sessionId
        observedReportLength = context.report.stages.length
        assert.equal(context.services.marker, true)
        assert.equal(context.cwd, 'D:\\AI_Work')
      },
    }),
  })
  assert.equal(observedSession, SESSION)
  assert.equal(observedReportLength, 5, 'five stages ran before memory')
})

/* ------------------------------------------------------------------- scan */

async function makeTree() {
  const root = await mkdtemp(join(tmpdir(), 'dsd-root-'))
  const projectA = join(root, '--D-AI_Work--')
  const projectB = join(root, '--D-AI_Work-~521B~4F5C--')
  const dirA = join(projectA, SESSION)
  const dirB = join(projectB, SESSION)
  await mkdir(dirA, { recursive: true })
  await mkdir(dirB, { recursive: true })
  await mkdir(join(projectB, 'session-other'), { recursive: true })
  await writeFile(join(dirA, 'session.v4.jsonl.zstd'), 'x'.repeat(32))
  await writeFile(join(dirA, 'session.v4.jsonl.lock'), '')
  await writeFile(join(dirB, 'session.v3.jsonl'), 'y'.repeat(8))
  await writeFile(join(projectB, 'session-other', 'session.v4.jsonl'), 'z')
  return { root, projectA, projectB, dirA, dirB }
}

test('SESSION_LOG_PATTERN recognises every generation filename', () => {
  assert.ok(SESSION_LOG_PATTERN.test('session.v4.jsonl.zstd'))
  assert.ok(SESSION_LOG_PATTERN.test('session.v3.jsonl'))
  assert.ok(!SESSION_LOG_PATTERN.test('session.vX.jsonl'))
  assert.ok(!SESSION_LOG_PATTERN.test('other.v4.jsonl'))
})

test('assertRemovable guards containment and basename', async () => {
  const { root, dirA, projectA, projectB } = await makeTree()
  try {
    assert.equal(assertRemovable(root, SESSION, dirA).ok, true)
    assert.equal(assertRemovable(root, SESSION, root).ok, false)
    assert.equal(assertRemovable(root, SESSION, projectA).ok, false, 'project dir is one level too high')
    assert.equal(assertRemovable(root, SESSION, projectB).ok, false, 'project dir is one level too high')
    assert.equal(assertRemovable(root, SESSION, join(root, '--x--', 'session-other')).ok, false)
    assert.equal(assertRemovable(root, SESSION, join(root, '..', 'escape', SESSION)).ok, false)
    assert.equal(assertRemovable(root, SESSION, '').ok, false)
    assert.equal(assertRemovable(root, '', dirA).ok, false)
    assert.equal(assertRemovable(root, SESSION, join(root, 'a', 'b', SESSION)).ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('findSessionDirs finds every project bucket for one session', async () => {
  const { root, dirA, dirB } = await makeTree()
  try {
    const found = await findSessionDirs(root, SESSION, { cwds: ['D:\\AI_Work'] })
    assert.equal(found.dirs.length, 2)
    assert.deepEqual([...found.dirs].sort(), [dirA, dirB].sort())
    const other = await findSessionDirs(root, 'session-other')
    assert.equal(other.dirs.length, 1)
    const missing = await findSessionDirs(root, 'session-absent')
    assert.deepEqual(missing.dirs, [])
    const noRoot = await findSessionDirs(join(root, 'nope'), SESSION)
    assert.deepEqual(noRoot.dirs, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('describeDir summarises logs, generation, lock and size', async () => {
  const { root, dirA } = await makeTree()
  try {
    const summary = await describeDir(dirA)
    assert.equal(summary.files, 2)
    assert.equal(summary.logs, 1)
    assert.equal(summary.generation, 'v4')
    assert.equal(summary.locked, true)
    assert.equal(summary.bytes, 32)
    assert.deepEqual(await describeDir(join(root, 'ghost')), {
      files: 0,
      bytes: 0,
      logs: 0,
      generation: undefined,
      locked: false,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('removeSessionDirs deletes all buckets, prunes only emptied projects', async () => {
  const { root, projectA, projectB, dirA, dirB } = await makeTree()
  try {
    const found = await findSessionDirs(root, SESSION)
    const result = await removeSessionDirs(root, SESSION, found.dirs)
    assert.equal(result.removed.length, 2)
    assert.deepEqual(result.failed, [])
    assert.deepEqual(result.pruneFailed, [])
    assert.deepEqual(result.pruned, [projectA], 'projectB still holds another session')
    await assert.rejects(() => stat(dirA))
    await assert.rejects(() => stat(dirB))
    await assert.rejects(() => stat(projectA))
    assert.deepEqual(await readdir(root), ['--D-AI_Work-~521B~4F5C--'])
    assert.deepEqual(await readdir(projectB), ['session-other'])
    assert.equal(result.removed[0].summary.logs, 1)

    const other = await findSessionDirs(root, 'session-other')
    const second = await removeSessionDirs(root, 'session-other', other.dirs)
    assert.equal(second.removed.length, 1)
    assert.deepEqual(second.pruned, [projectB])
    assert.deepEqual(await readdir(root), [], 'root is empty once every session is gone')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('removeSessionDirs refuses unvalidated paths instead of deleting them', async () => {
  const { root, dirA } = await makeTree()
  try {
    const result = await removeSessionDirs(root, SESSION, [root, join(root, '--D-AI_Work--', 'session-other')])
    assert.equal(result.removed.length, 0)
    assert.equal(result.failed.length, 2)
    assert.ok((await stat(dirA)).isDirectory(), 'nothing was touched')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('projection cache candidates and removal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsd-home-'))
  try {
    const candidates = projectionCacheCandidates(home, SESSION)
    assert.deepEqual(candidates, [join(home, 'storages', 'session_projcache', 'sessions', `${SESSION}.json`)])
    assert.deepEqual(projectionCacheCandidates('', SESSION), [])
    assert.deepEqual((await removeProjectionCache(home, SESSION)).removed, [])

    await mkdir(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    await writeFile(candidates[0], '{"version":7}')
    const result = await removeProjectionCache(home, SESSION)
    assert.deepEqual(result.removed, candidates)
    await assert.rejects(() => stat(candidates[0]))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
