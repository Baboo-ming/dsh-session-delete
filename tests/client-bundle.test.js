/**
 * Client-bundle contract tests.
 *
 * `lib/client.js` is hand-written (no build step exists in this checkout), so
 * these tests are the build's replacement: they evaluate the bundle exactly the
 * way `dsh-client-modules` does — through `window.__ModuleLoader__.load` — with
 * stubbed platform modules, then exercise the menu entry and the confirm dialog
 * against a stub slot registry.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { MENU_ORDER, MENU_SLOT, NS, OVERLAY_SLOT } from './helpers/client-contract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Evaluate the bundle and hand back the `{ id, factory }` it registered. */
async function loadBundle() {
  const code = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
  let captured
  const run = new Function('window', code)
  run({
    __ModuleLoader__: {
      load(definition) {
        captured = definition
      },
    },
  })
  assert.ok(captured, 'lib/client.js never called window.__ModuleLoader__.load')
  return { code, definition: captured }
}

/** Only the frozen platform modules the bundle is allowed to require. */
function makeRequire(required, runtime = null) {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length === 0 ? props?.children : children },
  })
  // Inert hooks: enough to evaluate the module and assert its structure, but
  // they never run effects or re-render, so `phase` stays at its initial
  // "loading". The dialog tests pass a `createHookRuntime()` instead.
  const inert = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect() {},
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
  const react = { createElement, ...(runtime === null ? inert : runtime.hooks) }
  const table = {
    react,
    'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement, Fragment: 'Fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': {
      MenuItemButton: 'MenuItemButton',
      Button: 'Button',
      Modal: 'Modal',
      IconTrashOutlineRegular: 'IconTrashOutlineRegular',
    },
  }
  return (specifier) => {
    required.push(specifier)
    if (!(specifier in table)) throw new Error(`bundle required a non-platform module: ${specifier}`)
    return table[specifier]
  }
}

/**
 * A tiny React-shaped hook runtime for the dialog tests.
 *
 * `lib/client.js` is hand-written, so these tests supply the React it renders
 * against. An audit flagged the previous inert stub: its `useEffect` never ran,
 * so `phase` stayed "loading", the confirm button was always disabled and the
 * suite could not observe the state a user actually gets. This runtime keeps
 * hook state across renders, runs effects and re-renders while state updates
 * are pending, so a test can drive preview → ready → deleting → closed.
 */
function createHookRuntime() {
  const slots = []
  const effects = new Map()
  let cursor = 0
  let dirty = false
  let scheduled = []

  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value
        dirty = true
      }
      return [slots[index], setState]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(callback, deps) {
      const index = cursor++
      const previous = effects.get(index)
      const changed =
        previous === undefined ||
        deps === undefined ||
        previous.deps.length !== deps.length ||
        deps.some((value, position) => !Object.is(value, previous.deps[position]))
      if (changed) scheduled.push({ index, callback, deps })
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
  }

  return {
    hooks,
    /** Render `invoke`; keep re-rendering while it schedules state updates. */
    render(invoke) {
      let element
      let pass = 0
      do {
        dirty = false
        cursor = 0
        scheduled = []
        element = invoke()
        for (const effect of scheduled) {
          const previous = effects.get(effect.index)
          if (previous?.cleanup) previous.cleanup()
          const cleanup = effect.callback()
          effects.set(effect.index, { deps: effect.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined })
        }
        pass += 1
      } while (dirty && pass < 25)
      assert.ok(pass < 25, 'hook state never settled: the component re-renders in a loop')
      return element
    },
  }
}

/**
 * Render the `shell.overlay` dialog entry the way the host renderer would: the
 * entry is a function component returning `DeleteConfirm`'s element, so both
 * components must run inside one hook pass (as React would).
 */
function renderDialog(runtime, app) {
  return runtime.render(() => {
    const entry = app.entries[1].component({})
    if (entry === null || entry === undefined) return null
    return typeof entry.type === 'function' ? entry.type(entry.props) : entry
  })
}

/** Let queued promises and their `then` continuations settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeClientCtx({ locale = 'zh' } = {}) {
  const entries = []
  const injected = []
  const effects = []
  const dictionaries = new Map()
  const sessionsRefresh = { count: 0 }
  const sessions = {
    refresh() {
      sessionsRefresh.count += 1
      return Promise.resolve()
    },
    list: { getSnapshot: () => ({ ids: [] }) },
  }
  return {
    entries,
    injected,
    effects,
    dictionaries,
    sessionsRefresh,
    sessions,
    ctx: {
      // `clientSessions()` looks the service up through `ctx.get` first, then
      // falls back to the injected property — provide both, like the host does.
      get: (name) => (name === 'sessions' ? sessions : undefined),
      sessions,
      // A real translator, not an echo: it resolves keys against whatever the
      // bundle registered, so a missing or renamed key shows up as the raw key.
      locale: {
        bind: (namespace) => (key, params) => {
          const text = dictionaries.get(namespace)?.[locale]?.[key]
          if (text === undefined) return key
          return params === undefined
            ? text
            : text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
        },
        register: (namespace, dict) => {
          dictionaries.set(namespace, dict)
          return () => {}
        },
      },
      slots: {
        inject(key, callback) {
          injected.push(key)
          const dispose = callback()
          assert.equal(typeof dispose, 'function', `slots.inject(${key}) must return a disposer`)
          return dispose
        },
        register(options, component) {
          entries.push({ options, component })
          return () => {}
        },
      },
      effect(callback, label) {
        effects.push({ label, callback })
        return () => {}
      },
    },
  }
}

/** Run `apply` with a stub `document`, then settle the collected effects. */
function mount(exports, options = {}) {
  const app = makeClientCtx(options)
  const appended = []
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => ({
      dataset: {},
      textContent: '',
      remove() {
        this.removed = true
      },
    }),
    head: {
      appendChild(node) {
        appended.push(node)
      },
    },
  }
  try {
    exports.apply(app.ctx)
    for (const effect of app.effects) {
      const dispose = effect.callback()
      assert.equal(typeof dispose, 'function', `effect(${effect.label}) must return a disposer`)
      effect.dispose = dispose
    }
  } finally {
    globalThis.document = previous
  }
  return { app, appended }
}

test('bundle wire format matches the lazy-CJS contract', async () => {
  const { code, definition } = await loadBundle()
  assert.equal(definition.id, 'dsh-session-delete')
  assert.equal(typeof definition.factory, 'function')
  assert.match(code, /^window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /return module\.exports;\s*\},?\s*\}\);\s*$/)
  assert.match(code, /exports\.apply = apply;/)
  assert.match(code, /exports\.inject = inject;/)
})

test('module constants in lib/client.js match the contract the tests assert', async () => {
  const { code } = await loadBundle()
  assert.ok(code.includes(`var NS = "${NS}"`), 'NS drifted from tests/helpers/client-contract.mjs')
  assert.ok(code.includes(`var MENU_SLOT = "${MENU_SLOT}"`), 'MENU_SLOT drifted')
  assert.ok(code.includes(`var OVERLAY_SLOT = "${OVERLAY_SLOT}"`), 'OVERLAY_SLOT drifted')
  assert.ok(code.includes(`var MENU_ORDER = ${MENU_ORDER}`), 'MENU_ORDER drifted')
})

test('the factory only requires frozen platform modules and exports apply/inject', async () => {
  const { definition } = await loadBundle()
  const required = []
  const exports = definition.factory(makeRequire(required))
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale', 'sessions'])
  assert.deepEqual([...required].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
})

test('apply registers the danger menu row and two shell.overlay entries', async () => {
  const { definition } = await loadBundle()
  const exports = definition.factory(makeRequire([]))
  const { app, appended } = mount(exports)

  assert.deepEqual(app.injected, [MENU_SLOT, OVERLAY_SLOT, OVERLAY_SLOT])
  assert.equal(app.effects.length, 3)
  assert.equal(appended.length, 1)
  assert.match(appended[0].textContent, /session-delete-confirm/)

  assert.equal(app.entries.length, 3)
  const menu = app.entries[0]
  assert.equal(menu.options.name, MENU_SLOT)
  assert.equal(menu.options.id, `${NS}.menu-item`)
  assert.equal(menu.options.order, MENU_ORDER)
  assert.equal(menu.options.order, 500, 'delete must sit after archive (400)')
  assert.equal(menu.options.locale, NS)
  assert.equal(menu.options.label(), '删除会话')

  // the registered label is a thunk over the active locale, so the English
  // build of the same registration resolves differently
  const en = mount(definition.factory(makeRequire([])), { locale: 'en' })
  assert.equal(en.app.entries[0].options.label(), 'Delete session')

  const dialog = app.entries[1]
  const toast = app.entries[2]
  assert.equal(dialog.options.name, OVERLAY_SLOT)
  assert.equal(toast.options.name, OVERLAY_SLOT)
  assert.equal(toast.options.order > dialog.options.order, true)
})

test('the menu row is danger-styled, uses the trash icon and opens the dialog', async () => {
  const { definition } = await loadBundle()
  const exports = definition.factory(makeRequire([]))
  const { app } = mount(exports)

  const menu = app.entries[0]
  const dialog = app.entries[1]
  let closed = 0
  const element = menu.component({
    sessionId: 'session-abc',
    displayTitle: '被删除的会话',
    useMenuOpenState: () => [false, () => { closed += 1 }],
  })

  assert.equal(element.type, 'MenuItemButton')
  assert.equal(element.props.danger, true)
  assert.equal(element.props.children, '删除会话')
  assert.equal(element.props.icon.type, 'IconTrashOutlineRegular')
  assert.equal(element.props.icon.props.size, 14)

  // nothing is open until the row is selected
  assert.equal(dialog.component({}), null)

  element.props.onSelect()
  assert.equal(closed, 1)

  // The overlay entry is a function component returning the per-request
  // `DeleteConfirm` element; rendering it once yields the Modal element.
  const confirmElement = dialog.component({})
  assert.equal(typeof confirmElement.type, 'function')
  const modal = confirmElement.type(confirmElement.props)
  assert.equal(modal.type, 'Modal')
  assert.equal(modal.props.open, true)
  assert.equal(modal.props.title, '永久删除该会话')
  assert.equal(modal.props.description, '此操作不可撤销：会话记录、磁盘日志与工作区挂账都会被清除。')
  assert.deepEqual(modal.props.footer.map((button) => button.type), ['Button', 'Button'])
  assert.equal(modal.props.footer[0].props['data-modal-autofocus'], true, 'the safe action holds initial focus')
  assert.equal(modal.props.footer[1].props.className, 'session-delete-confirm')
  assert.equal(modal.props.footer[1].props.variant, 'outline')
  // the destructive button must not be the initially focused one
  assert.equal(modal.props.footer[1].props['data-modal-autofocus'], undefined)
})

test('the dictionaries are parity-complete and free of raw-key fallbacks', async () => {
  const { definition } = await loadBundle()
  const exports = definition.factory(makeRequire([]))
  const { app } = mount(exports)
  const dict = app.dictionaries.get(NS)
  assert.ok(dict, `the bundle never registered the ${NS} locale dictionaries`)

  const zh = Object.keys(dict.zh).sort()
  const en = Object.keys(dict.en).sort()
  assert.ok(zh.length >= 25, 'the dictionary should cover the whole dialog')
  assert.deepEqual(en, zh, 'zh and en must define exactly the same keys')
  for (const key of zh) {
    assert.notEqual(dict.zh[key], key, `zh is missing a translation for ${key}`)
    assert.notEqual(dict.en[key], key, `en is missing a translation for ${key}`)
    assert.ok(String(dict.zh[key]).trim().length > 0, `${key} is empty in zh`)
    assert.ok(String(dict.en[key]).trim().length > 0, `${key} is empty in en`)
  }
  // keys the dialog path depends on
  for (const key of ['menu.deleteSession', 'dialog.title', 'dialog.cancel', 'dialog.delete', 'dialog.forceDelete', 'toast.deleted']) {
    assert.ok(key in dict.zh && key in dict.en, `missing ${key}`)
  }
})

test('the shipped slot contract still matches the reference client tree', async (t) => {
  const refRoot = join(ROOT, '.ref', 'dsh', 'node_modules', '@deepseek-ai')
  const runnerPath = join(refRoot, 'dsh-cordis-client-runner', 'lib', 'client.js')
  const primitivesPath = join(refRoot, 'dsh-client-ui-primitives', 'lib', 'index.js')
  const menuCssPath = join(refRoot, 'dsh-client-ui-primitives', 'lib', 'Menu.module.css')
  const workspacePath = join(refRoot, 'dsh-client-ui-workspace', 'lib', 'client.js')

  const readable = async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }
  const runner = await readable(runnerPath)
  if (runner === undefined) {
    t.skip('the unpacked reference tree (.ref/) is not present in this checkout')
    return
  }

  // the slot this bundle registers on really exists, is a root-scope list, and
  // hands out the props/hook the row and dialog rely on
  assert.ok(runner.includes(`key: "${MENU_SLOT}"`), `${MENU_SLOT} is no longer a declared slot`)
  const slotIndex = runner.indexOf(`key: "${MENU_SLOT}"`)
  const slotBlock = runner.slice(slotIndex, slotIndex + 4000)
  assert.match(slotBlock, /kind: "list"/)
  assert.match(slotBlock, /scope: "root"/)
  assert.match(slotBlock, /sessionId/)
  assert.match(slotBlock, /displayTitle/)
  assert.match(slotBlock, /useMenuOpenState/, 'the slot no longer injects the menu-open hook')
  assert.match(slotBlock, /client-ui-workspace ArchiveSessionMenuItem id 'archive'/, 'archive is no longer a shipped occupant')
  assert.ok(slotBlock.includes('declaredBy'), 'slot metadata shape changed')

  // `danger` on MenuItemButton is the documented red style, driven by the
  // error alias in the primitives stylesheet
  const css = await readable(menuCssPath)
  assert.ok(css, 'Menu.module.css must exist')
  assert.match(css, /--dsw-alias-state-error-primary/, 'danger styling alias changed')

  // the primitives this bundle consumes are real exports
  const primitives = await readable(primitivesPath)
  assert.ok(primitives, 'the primitives bundle must exist')
  for (const name of ['MenuItemButton', 'Modal', 'Button', 'IconTrashOutlineRegular']) {
    const token = new RegExp(`\\b${name}\\b`)
    assert.match(primitives, token, `@deepseek-ai/dsh-client-ui-primitives no longer exports ${name}`)
  }

  // the shipped rows really occupy 100/200/300/400, so order 500 lands last
  const workspace = await readable(workspacePath)
  assert.ok(workspace, 'the workspace client bundle must exist')
  assert.equal(MENU_ORDER > 400, true)
  assert.match(workspace, /ArchiveSessionMenuItem/)
  assert.match(workspace, new RegExp(MENU_SLOT.replace(/\./g, '\\.')))
})

test('the confirm button is disabled until the preview lands, and a second click cannot double-delete', async () => {
  const { definition } = await loadBundle()
  const hooks = createHookRuntime()
  const exports = definition.factory(makeRequire([], hooks))
  const { app } = mount(exports)
  const dict = app.dictionaries.get(NS)

  app.entries[0]
    .component({
      sessionId: 'session-dup',
      displayTitle: '重复点击',
      useMenuOpenState: () => [false, () => {}],
    })
    .props.onSelect()

  const calls = []
  let resolveDelete
  const previousFetch = globalThis.fetch
  globalThis.fetch = (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/health')) {
      return Promise.resolve({ status: 200, json: async () => ({ ok: true, value: { token: 'tok' } }) })
    }
    if (target.includes('/preview')) {
      return Promise.resolve({
        status: 200,
        json: async () => ({ ok: true, value: { sessionId: 'session-dup', activity: [], valid: true } }),
      })
    }
    return new Promise((resolve) => {
      resolveDelete = resolve // the delete never settles on its own: it must stay in flight
    })
  }
  try {
    // first paint: the preview is still in flight, so confirming is impossible
    const loading = renderDialog(hooks, app)
    assert.equal(loading.props.footer[1].props.disabled, true, 'the preview must gate the destructive button')

    await settle()
    const ready = renderDialog(hooks, app)
    const [cancel, confirm] = ready.props.footer
    assert.equal(confirm.props.disabled, false, 'a ready preview enables confirmation')
    assert.equal(confirm.props.children, dict.zh['dialog.delete'])
    assert.equal(cancel.props['data-modal-autofocus'], true, 'the safe action holds initial focus')

    confirm.props.onClick()
    const inFlight = renderDialog(hooks, app)
    const [inFlightCancel, inFlightConfirm] = inFlight.props.footer
    assert.equal(inFlightConfirm.props.disabled, true, 'the destructive button locks while the delete runs')
    assert.equal(inFlightCancel.props.children, dict.zh['close'])
    assert.equal(inFlightCancel.props.disabled, undefined, 'cancel must remain clickable in flight')

    // a real user cannot click a disabled button; a stray second click must
    // still not issue a second delete
    inFlightConfirm.props.onClick()
    await settle()

    const deletes = calls.filter((url) => url.includes('/session-delete/delete'))
    assert.equal(deletes.length, 1, 'a second click must not issue a second delete')
    assert.equal(app.sessionsRefresh.count, 0, 'the list must not refresh while the delete is in flight')
  } finally {
    globalThis.fetch = previousFetch
    if (resolveDelete) {
      resolveDelete({ status: 200, json: async () => ({ ok: true, value: { deleted: true, stages: [] } }) })
      await settle() // clear the request deadline instead of leaving a 20s timer behind
    }
  }
})

test('the toast overlay is null until a notice is pushed', async () => {
  const { definition } = await loadBundle()
  const exports = definition.factory(makeRequire([]))
  const { app } = mount(exports)
  assert.equal(app.entries[2].component({}), null)
})

test('a successful force delete sends the boot token, toasts, refreshes the list and closes', async () => {
  const { definition } = await loadBundle()
  const hooks = createHookRuntime()
  const exports = definition.factory(makeRequire([], hooks))
  const { app } = mount(exports)
  const dict = app.dictionaries.get(NS)

  app.entries[0]
    .component({
      sessionId: 'session-gone',
      displayTitle: '待删除会话',
      useMenuOpenState: () => [false, () => {}],
    })
    .props.onSelect()
  // the overlay renders the pending request once the menu row has selected it
  assert.notEqual(app.entries[1].component({}), null)

  const requests = []
  let resolveDelete
  const deleteSettled = new Promise((resolve) => {
    resolveDelete = resolve
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = (url, options) => {
    const target = String(url)
    requests.push({ url: target, options: options ?? {} })
    if (target.includes('/health')) {
      return Promise.resolve({ status: 200, json: async () => ({ ok: true, value: { token: 'boot-token' } }) })
    }
    if (target.includes('/preview')) {
      return Promise.resolve({
        status: 200,
        json: async () => ({
          ok: true,
          value: {
            sessionId: 'session-gone',
            activity: [{ kind: 'turn' }], // the session is running
            valid: true,
            dirs: [{ path: 'C:\\logs\\x', locked: true }],
            totalFiles: 1,
            totalBytes: 10,
            workspaces: [],
            archived: false,
            pinned: false,
          },
        }),
      })
    }
    return deleteSettled.then(() => ({
      status: 200,
      json: async () => ({ ok: true, value: { deleted: true, stages: [] } }),
    }))
  }

  try {
    const loading = renderDialog(hooks, app)
    assert.equal(loading.props.footer[1].props.disabled, true, 'confirming is impossible before the preview lands')

    await settle()
    const ready = renderDialog(hooks, app)
    const confirm = ready.props.footer[1]
    assert.equal(confirm.props.disabled, false, 'a ready preview enables confirmation')
    // a running session turns the button into the force variant and warns first
    assert.equal(confirm.props.children, dict.zh['dialog.forceDelete'])
    const alerts = ready.props.children.filter((node) => node && node.props && node.props.role === 'alert')
    const busyWarning = alerts.find((node) => String(node.props.children) === dict.zh['dialog.busy'].replace('{n}', '1'))
    assert.ok(busyWarning, 'a running session must warn that a force stop is required')
    assert.ok(
      ready.props.children.some((node) => node && node.props && String(node.props.children) === dict.zh['dialog.locked']),
      'a locked log directory must be surfaced before deleting',
    )

    confirm.props.onClick()
    const deleting = renderDialog(hooks, app)
    assert.equal(deleting.props.footer[1].props.disabled, true)
    assert.equal(deleting.props.footer[0].props.children, dict.zh['close'])
    await settle()

    const deletion = requests.find((entry) => entry.url.includes('/session-delete/delete'))
    assert.ok(deletion, 'confirming must POST to the delete route')
    assert.equal(deletion.options.method, 'POST')
    assert.equal(
      deletion.options.headers['x-session-delete-token'],
      'boot-token',
      'the per-boot token from /health must travel with the delete',
    )
    assert.deepEqual(JSON.parse(deletion.options.body), { sessionId: 'session-gone', force: true })

    // the request is in flight: no refresh / no toast yet
    assert.equal(app.sessionsRefresh.count, 0)
    resolveDelete()
    await settle()
    await settle()

    assert.equal(app.sessionsRefresh.count, 1, 'a successful delete must refresh the session list')
    const toast = app.entries[2].component({})
    assert.notEqual(toast, null, 'a success toast must be shown')
    assert.match(String(toast.props.children), new RegExp(dict.zh['toast.deleted']))
    assert.equal(renderDialog(hooks, app), null, 'the dialog must close after success')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a refused delete keeps the dialog open and names the failing stages', async () => {
  const { definition } = await loadBundle()
  const hooks = createHookRuntime()
  const exports = definition.factory(makeRequire([], hooks))
  const { app } = mount(exports)
  const dict = app.dictionaries.get(NS)

  app.entries[0]
    .component({
      sessionId: 'session-busy',
      displayTitle: '忙会话',
      useMenuOpenState: () => [false, () => {}],
    })
    .props.onSelect()

  const requests = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (url, options) => {
    const target = String(url)
    requests.push({ url: target, options: options ?? {} })
    if (target.includes('/health')) {
      return Promise.resolve({ status: 200, json: async () => ({ ok: true, value: { token: 'boot-token' } }) })
    }
    if (target.includes('/preview')) {
      return Promise.resolve({
        status: 200,
        json: async () => ({ ok: true, value: { sessionId: 'session-busy', activity: [], valid: true } }),
      })
    }
    // the host refuses (409) and carries the pipeline report as `value`
    return Promise.resolve({
      status: 409,
      json: async () => ({
        ok: false,
        error: { code: 'refused', message: '会话正在运行，需要 force' },
        value: {
          deleted: false,
          stages: [
            { key: 'running-guard', status: 'blocked', detail: 'session is busy' },
            { key: 'disk-logs', status: 'failed', detail: 'EBUSY' },
          ],
          leftoverDiskPaths: ['C:\\logs\\x.jsonl'],
        },
      }),
    })
  }

  try {
    const loading = renderDialog(hooks, app)
    assert.equal(loading.props.footer[1].props.disabled, true)
    await settle()
    const ready = renderDialog(hooks, app)

    ready.props.footer[1].props.onClick()
    await settle()
    await settle()

    const refused = renderDialog(hooks, app)
    assert.notEqual(refused, null, 'a refusal must leave the dialog open so the user can retry')
    const items = refused.props.children
    const alert = items.find((node) => node && node.props && node.props.className === 'session-delete-error')
    assert.ok(alert, 'the host message must be shown')
    assert.equal(String(alert.props.children), '会话正在运行，需要 force')
    assert.equal(alert.props.role, 'alert')

    const detail = items.find((node) => node && node.props && node.props.className === 'session-delete-detail')
    assert.ok(detail, 'the refusal report must be rendered, not just the HTTP status')
    const rendered = JSON.stringify(detail)
    assert.match(rendered, /disk-logs/)
    assert.match(rendered, /EBUSY/)
    assert.match(rendered, /running-guard/)
    assert.match(rendered, /C:\\\\logs\\\\x\.jsonl/)

    assert.equal(app.sessionsRefresh.count, 0, 'a refused delete must not refresh the list')

    // the refusal is toasted as an error (never as a success) ...
    const toast = app.entries[2].component({})
    assert.notEqual(toast, null, 'a refusal must be reported to the user')
    assert.match(toast.props.className, /session-delete-toast-error/)
    assert.equal(
      String(toast.props.children),
      dict.zh['toast.failed'].replace('{message}', '会话正在运行，需要 force'),
    )

    // ... and the dialog arms the retry with force instead of failing silently
    const retry = renderDialog(hooks, app)
    assert.equal(retry.props.footer[1].props.children, dict.zh['dialog.forceDelete'])
    retry.props.footer[1].props.onClick()
    await settle()
    const posts = requests.filter((entry) => entry.url.includes('/session-delete/delete'))
    assert.equal(posts.length, 2, 'retrying after a refusal must issue the delete again')
    assert.equal(JSON.parse(posts[1].options.body).force, true, 'the retry must carry force')
  } finally {
    globalThis.fetch = previousFetch
  }
})
