/**
 * Diagnostic harness: build a throw-away DSH home, run the deletion pipeline
 * against it and print the full report. Never touches the real `~/.dsh`.
 *
 *   node tools/doctor.mjs [--live] [--registry] [--force]
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeSegment, projectDir } from '../lib/core/paths.js'
import { createSessionDeleter } from '../lib/index.js'

const flags = new Set(process.argv.slice(2))
const sessionId = 'session-11111111-2222-3333-4444-555555555555'
const cwd = join('D:', 'AI_Work', '开发', '删除会话插件')
const workspaceId = 'ws-abc'

const home = await mkdtemp(join(tmpdir(), 'session-delete-doctor-'))
const sessionsRoot = join(home, 'sessions')
const dir = join(projectDir(sessionsRoot, cwd, join), encodeSegment(sessionId))
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'session.v4.jsonl.zstd'), Buffer.from('deadbeef', 'hex'))
const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
await mkdir(cacheDir, { recursive: true })
await writeFile(join(cacheDir, `${sessionId}.json`), '{"version":7}')
await writeFile(join(home, 'storages', 'workspace.json'), JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: {
    initialized: true,
    defaultWorkspaceId: workspaceId,
    workspaceIds: [workspaceId],
    archivedSessionIds: [sessionId],
    pinnedSessionIds: [],
  },
  tables: {
    workspaces: {
      [workspaceId]: { path: cwd, title: '删除会话插件', sessionIds: [sessionId, 'session-keep-me'], createdAt: 1, updatedAt: 1 },
    },
  },
}, null, 2))

const live = flags.has('--live')
const useRegistry = flags.has('--registry')
const calls = { detach: 0 }
const records = new Map([[workspaceId, { path: cwd, title: '删除会话插件', sessionIds: [sessionId, 'session-keep-me'], createdAt: 1, updatedAt: 1 }]])
const state = { initialized: true, defaultWorkspaceId: workspaceId, workspaceIds: [workspaceId], archivedSessionIds: [sessionId], pinnedSessionIds: [] }

const ctx = {
  logger: { info: (...a) => console.log('[host]', ...a), warn: (...a) => console.log('[warn]', ...a), error: (...a) => console.log('[error]', ...a) },
  get: (name) => ({
    sessions: {
      get: (id) => (live && id === sessionId ? { id, header: { cwd } } : undefined),
      liveEntryFor: (session) => ({ id: session.id, announced: true }),
      flush: async () => {},
      detachEntered: async () => { calls.detach += 1 },
    },
    workspaceRegistry: useRegistry
      ? {
        requireTable: () => ({
          keys: () => [...records.keys()],
          get: (key) => records.get(key),
          update: async (key, fn) => {
            const next = fn(records.get(key))
            records.set(key, next)
            return next
          },
        }),
        requireState: () => state,
        setState: async (next) => Object.assign(state, next),
        sessionKnown: (id) => id === sessionId,
        readSessionHeader: (id) => (id === sessionId ? { id, cwd } : undefined),
        stopSessionActivity: async () => {},
        enqueueOperation: (operation) => operation(),
      }
      : undefined,
  })[name],
  emit: (event, ...args) => console.log('[emit]', event, args),
  waterfall: async () => (flags.has('--busy') ? [{ kind: 'turn' }] : []),
  parallel: async () => {},
  inject: () => {},
  effect: () => {},
}

const { deleteSession, runtime } = createSessionDeleter(ctx, { dshHome: home })
console.log('paths:', runtime.paths)
console.log('disk targets:', (await runtime.diskTargets(sessionId)))
const report = await deleteSession(sessionId, { force: flags.has('--force') })
console.log(JSON.stringify(report, null, 2))
console.log('detach calls:', calls.detach)
console.log('ledger after:', await (await import('node:fs/promises')).readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
console.log('session dir still there?', await (await import('node:fs/promises')).stat(dir).then(() => true, () => false))
await rm(home, { recursive: true, force: true })
