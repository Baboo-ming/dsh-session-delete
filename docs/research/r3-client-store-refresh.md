# R3 — DSH client session store & sidebar refresh after a host-side session delete

Source of truth: extracted app `D:\AI_Work\开发\删除会话插件\.ref\dsh\node_modules\@deepseek-ai\`, cross-checked against
plugins installed in `C:\Users\ming\.dsh\profiles\desktop\node_modules\`. **UNVERIFIED** = not confirmed by a file read.

## 1. The sessions store (Q1)

**Owner** — `dsh-api-session-controller\lib\types\client\sessions\service.js:186`
`rootCtx.reflect.provide('sessions', this, undefined);` → `ctx.sessions` / `ctx.get('sessions')` **is** this
`ClientSessions` (`service.js:140-578`; fields `rootCtx`, `list`, `manager`, `scopes`, `retainObservers`, `searchResultLimit
= SESSION_SEARCH_RESULT_LIMIT`, `closed`).

**`sessions.list`** — `service.js:165-167`
`this.list = createSnapshotStore({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} });`, re-projected by
`projectList()` (`service.js:491-563`) via `this.list.set({ ids, byId, phase, projectionsBySession })`; row shape
(`byId[sessionId]`) = `{ id, displayTitle, running, retainedBy, blank, updatedAt, projectionValues?, title?, cwd?, parentId?,
origin? }`. Engine `dsh-client-store\lib\index.js`: `createSnapshotStore(init, opts)` → `{ getSnapshot, subscribe, update,
set }` (opts `{ flush?: 'sync'|'raf', persist?: { name } }`) plus `defineStore`, `shallowEqual`, `notifySubscribers`;
React-free (zustand-vanilla + immer), the hook is synthesised by `dsh-client-ui-renderer` (uSES bridge). **Zero occurrences
of `refresh` in `dsh-client-store`** — engine only.

**Manager layer** — `manager.js:520` `getListSnapshot() { this.notifier.ensureFresh(); return this.listSnapshotCache; }`
(shape `{ items, state, phase, error, projectionsBySession }`); `manager.js:513` `subscribe(listener)` → `Notifier`
(`...\sessions\notifier.js`, 98 lines: microtask `markDirty()`, raf `markFrameDirty()`, sync `ensureFresh()`, lazy `flush()`
skipping rebuild while `listeners.size === 0`).

**`refresh()` exact** — `service.js:249-255`: `/** Refresh the real Session baseline, reusing an in-flight pull. */`
`refresh() { return this.manager.refreshList(); }`. Owner `ctx.sessions`; `refresh(): Promise<void>` (resolves when the pull
settles; carrier failures land in `listState='error'`, they do not reject). Sibling `refreshProjections(sessionId)`
(`service.js:246-248`). `SessionManager.refreshList()` (`manager.js:319`, doc *"Full refresh via session.list (single-flight
within one Host generation)"*): reuse the in-flight promise if any; `listState='loading'`; snapshot `established =
this.summaries`, open mutation buffer `mutations`; `await this.remote.session.list({})`; on `ok` merge
`mergeOrderedBaseline(established, result.value.items, s => s.sessionId)` (full replace while `listPhase==='pending'`),
replay buffered mutations (`mutations.reduce(applyMutation, baseline)`), prune engagement, set `listState='idle'` /
`listPhase='ready'`, sync `blank`/`running` into resident Sessions, apply each row's projection block (`applyListBlock`); on
failure `listState='error'`/`listError`; `finally` clears the buffer and calls `notifier.markDirty()`.
**Grep survey of refresh entry points (whole tree):** `ClientSessions.refresh` (`service.js:253`),
`ClientSessions.refreshProjections` (`service.js:246`), `SessionManager.refreshList` (`manager.js:319`),
`SessionManager.refreshProjections`, and the only consumer call `ctx.sessions.refreshProjections(parentSessionId)`
(`dsh-client-ui-subagent\lib\client.js:960`). **No literal `sessions.refresh()` call ships anywhere**;
`dsh-client-ui-workspace` has zero hits.

**Sidebar consumption** — `dsh-client-ui-workspace\lib\client.js:4108-4117`
`inject = ['slots','sessions','workspaces','locale','remote','remote.directoryPicker','layout','shortcuts']`; `:4124-4141`
`const sessions = ctx.get("sessions");` … `new UiWorkspaceService(ctx, ctx.remote.directoryPicker, workspaces, sessions,
viewInstance.actions, notify)`. `UiWorkspaceService` also subscribes directly (`:917`
`const disposeSessions = this.sessions.list.subscribe(reconcile)`), reads `this.sessions.list.getSnapshot()`
(`:802, 848, 871, 901`), and retains via `this.sessions.retain(target, { source: "mainView" })` (`:973`).
`useSessions` is **not defined in ui-workspace** — the slot framework injects it as a prop: `WorkspaceBrowser({ ...,
useSessions, ... })` (`:2793`) → `useSessions((state) => state)` (`:2799`); `SearchResults` `useSessions((s) => s)`
(`:2727`). Snapshot shape confirmed by `state.byId[sessionId]?.cwd` (`dsh-client-ui-conversation\lib\client.js:16220`),
`?.blank` (`:16013`), `state.projectionsBySession` / `state.byId` (`dsh-client-ui-subagent\lib\client.js:354-355`),
`state.phase === 'pending'` (`dsh-experimental-client-ui-agent-team\lib\client.js:241`),
`Object.values(state.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id` (`dsh-client-ui-cordis\lib\client.js:741`);
slot props declare `"useSessions: UseSessions"`; `dsh-client-ui-renderer\lib\client.js:705` documents
"useSessions/useWorkspaces hooks, the per-session provide bundle".

## 2. Host↔client session data flow (Q2)

**Client call path** — `remote.session.list` is generated typert at
`dsh-api-session-controller\lib\typert.remote-client.js:1108-1112` (id `@deepseek-ai/dsh-api-session-controller#session/list`,
`service: sessionController`, `invocation: { kind: 'direct' }`). That file's whole method set: `fileReferences/list`;
`session/{attachment,cancel,canOpenWorkspacePath,control,create,follow,fork,initializeDefaultModel,list,modelCatalog,
openWorkspacePath,page,projections,prompt,rename,search,selectModel,updateQueue,workspacePathApplications}`; `skills/list`.
**No delete/remove/archive.**
Gateway contract (`dsh-api-gateway\README.md`): :52 `ctx.remote.$mount(contribution)` "validates and registers a generated
Host-for-Client contribution, then installs concrete direct and scoped methods for the calling Cordis fiber. Each namespace
is a traced `remote.<namespace>` child Service and unloads after its last method is withdrawn"; :54 "Every unary call checks
positional arity, constructs the descriptor's exact named `args`, and sends the typed values through
`ctx.connection.rpc.call('/api', endpoint, ...)`"; :56 "Every unary call resolves to `RemoteResult<T>` — `{ ok: true, value }`
or `{ ok: false, error }` — and never rejects for a carrier problem"; `throw result.error` keeps throw semantics;
`isRemoteFailure(value)` is the one predicate; :62 `$on()` subscriptions belong to the calling fiber and `$host` is plain
`{home, isLoopback}` (reconnection via `connection/reset`, :58). Host side (:27): "Business Services extend
`TypertRemoteService` and mark methods with `@Remote` or `@RemoteScope` from `dsh-typert-protocol`; `bindTypertRemote()`
remains available when another base class owns inheritance." In-tree unwrap idiom
(`dsh-client-ui-workspace\lib\client.js:4148-4152`): `const result = await sessions.search(query, signal); if (!result.ok)
throw new Error(result.error.message); return result.value;`

**Host push (the removal channel)** — client wiring `dsh-api-session-controller\lib\client.js:3611-3658` (`inject` at
`:3598-3606` includes `'remote'`, `'remote.session'`, `'remote.subagents'`):
`const sessions = new ClientSessions(ctx, remotes);` then
`ctx.remote.$on("api-session/added", (summary) => sessions.handleSessionAdded(summary));` and `:3618`
`ctx.remote.$on("api-session/removed", (sessionId) => sessions.handleSessionRemoved(sessionId));` (plus status, activity and
error siblings).
Allowlist `dsh-api-remotes\lib\types\remote-events.js:18` `{ event: 'api-session/removed', mode: 'emit' }` (siblings
`activity` :15, `added` :16, `error` :17, `status` :19); `dsh-api-remotes\README.md:43` — that array is the legal key set of
`ctx.remote.$on` and the single source for the host forwarding loop (one-way notifications are not replayed after reconnect,
:77). Host emission `dsh-api-session-controller\lib\types\index.js:242-244` (mirror `lib\index.js:2876-2878`):
`ctx.on('session/disposed', (session) => { ctx.emit('api-session/removed', session.id); });`
Companion `session/created` → `api-session/added` (`types\index.js:239-241`); declared at
`dsh-api-session-controller\lib\typert.host.js:3181-3183` `"name": "api-session/removed",
"signature": "'api-session/removed'(sessionId: SessionId): void"`. Handler `manager.js:593` `handleSessionRemoved(sessionId)`
→ `recordMutation(durableSubagent ? { kind:'status', sessionId, running:false, agentAvailable:false } : { kind:'remove',
sessionId })`, then `session.handleRemoved()` / `handleRunning(false)`, drops projection stores + in-flight reads, prunes
engagement, marks child addresses unavailable; `applyMutation` (`manager.js:720-767`) implements `remove` as
`summaries.filter(summary => summary.sessionId !== mutation.sessionId)`. Host list source: `ApiSessionList.list(signal)` →
`this.ctx.sessionQuery.listSessions(signal)` (`dsh-api-session-controller\lib\types\list.js`), served by `session.list`
(`types\index.js:324-325`).

**Invoking a custom host method** — the plugin ships a typert manifest as its `./typert` export (host face) and mounts a
client contribution with `$mount`. `dsh-typert-loader\README.md`: mounting `dsh-typert-registry` + `dsh-typert-loader` makes
every package in the Loader composition contribute its generated `./typert` automatically (withdrawn on unmount; packages
without it skipped silently); verdicts are cached for the process lifetime, so adding `./typert` requires a restart;
`packages: []` covers plugins nested behind another Loader entry. `dsh-typert-registry\lib\types\service.js:340-519`:
`class TypertRegistry extends Service` (`super(ctx, 'typert')`); `register(contribution)` — "Register one generated
contribution atomically for the calling fiber. Duplicate package-face identities, schemas, invocation ids, or endpoints
reject the whole batch. @returns the exact effect disposer…" (via `this.ctx.effect(...)`); `validatePackage` requires `face`
∈ `{'host','client'}` and rejects duplicate package faces; `validateSchemas` requires `typeof schema.create === 'function'`;
`resolve(key)` throws `typert: cannot resolve "..." — package "..." has no registered contribution`.
Host manifest shape (`dsh-cost-meter\lib\typert.host.js`, 894 lines):
`const TYPERT = { package: 'dsh-cost-meter', face: 'host', schemas: [], invocations: [ ... ], model: { services: [...] } };
export default TYPERT;` — each invocation is `{ id: 'dsh-cost-meter#costMeter/getState', service: 'costMeter', namespace:
'costMeter', method: 'getState', invocation: { kind: 'direct' }, parameters: [], result: _state$codec }` and each parameter
`{ name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec }` (+ `acceptsUndefined: true` when optional).
Strict codecs are mandatory: a bare zod schema is rejected with **"parameter codec must use a strict codec"** and the host
fails to start (`dsh-cost-meter\lib\typert.host.js:630-635`). Client contribution + mount + namespace fetch
(`dsh-cost-meter\lib\client.js` line 6):
`const eo = ["remote"];` (inject list) then `async function to(t) { const s = t.remote; if (s === void 0 || typeof
s.$mount != "function") return; const o = await s.$mount(gn);` — `gn = { package: "dsh-cost-meter", descriptors: [...] }` —
`t.effect(() => () => { o(); }, "cost-meter: remote contribution");` (fiber-owned teardown) —
`const a = t.get("remote.costMeter");` (the callable namespace service) — `if (a === void 0) return;`.
Descriptor helpers (`client.js` line 2): `ve=(t,s)=>({ mode:"strict", typeSymbol:"dsh-cost-meter#"+t, schema:s, create:()=>s })`;
`ce=(t,s,o,a=!1)=>({ name:t, wire:t, source:"json", codec:ve(s,o), ...(a?{acceptsUndefined:!0}:{}) })`.

## 3. Real client→host call + error handling + toast (Q3)

**Complete third-party example** (`dsh-cost-meter\lib\client.js` line 6) — unary results are `RemoteResult`, so the caller
must throw: `r = async (C, Q) => { const Z = await a[C](...Q ?? []); if (Z === null || typeof Z != "object" || Z.ok !== !0)
throw new Error(Z?.error?.message ?? i()("rpcFailed", { method: C })); return Z.value; };`
Call sites: `getSessionCost: async C => r("getSessionCost", [C])`, `getTurnCost: async (C, Q, Z) => r("getTurnCost", [C, Q,
Z])`, `resetHistory: async () => { const C = await r("resetHistory"); ... }`. A second wrapper
(`S = async (C, Q="rpcSyncFailed", Z=!1) => { const oe = await C; if (oe?.ok !== !0) throw new Error(...); ...
l.set({ status:"ready", error:null, state: oe.value.state }); return oe.value; }`) folds the returned state into the local
store. React-side consumption guards in-flight and swallows errors
(`try { const p = await t.api.getSessionCost(t.sessionId); r && l({...}) } catch {} finally { d = !1 }`). Lifecycle patterns
worth copying: `t.effect(() => t.on("connection/reset", () => { f(); }), "cost-meter: reconnect reload")`;
`t.inject(["locale"], h)` with `t.get("locale")` fallback; `document.addEventListener("visibilitychange", x)` paired with an
effect-owned `removeEventListener`; lazy chunk `$e.async("./client.statistics.js").then(C => C.mount(t))`.

**Toasts/notices are private to ui-workspace** — `dsh-client-ui-workspace\lib\client.js:4133-4140`:
`const rowToast = createSnapshotStore(null); let toastSeq = 0; const notify = (toast) => { rowToast.set({ ...toast, seq:
++toastSeq }); };` — created inside `apply(ctx)`, never provided as a service. Overlay registration (`:4390-4396`):
`ctx.slots.register({ name: "shell.overlay", id: "workspace.row-toast", locale: NS, store: viewStore, inject:
rowToastInjected }, RowActionToast)`. `RowActionToast({ useToast, useStore, dismissToast, undoArchive, showArchived, t })`
(`:3809-3847`) renders the primitive `Toast` with `{ text, tone: "success", holdMs: LONG_TOAST_HOLD_MS /* 6e3, :3799 */,
actions: [{ label, onClick, prefix? }], icon, onDone }`. Success case (`kind:'archived' | 'stoppedAndArchived'`, `:3813-3835`)
= `tone:"success"` + undo action + optional show-archived action; failures (`createFailed` and the plain fallback for
`pinFailed`/`unpinFailed`/`defaultWorkspaceFailed`/`archivedNotOpenable`) = `icon: IconWarningOutlineRegular` +
`plainNoticeText(toast, t)` (`:3836-3858`; the switch ends in `assertNever(toast)`). `notifyArchivedNotOpenable()` is just
`notify({ kind: "archivedNotOpenable" })` (`:4267-4269`), exposed via `rowToastInjected`. **A third-party plugin cannot call
`notify`/`notifyArchivedNotOpenable`** — register your own `shell.overlay` slot with your own `createSnapshotStore(null)`
toast store, mirroring `:4133-4140` + `:4390-4396`, and render `Toast` (`:3815`
`_deepseek_ai_dsh_client_ui_primitives.Toast`) — **UNVERIFIED** whether that specifier is in the shell's frozen
`PLATFORM_MODULES` for third-party bundles.

**Error classification across bundle boundaries** — `dsh-client-ui-workspace\lib\client.js:4413-4417` (comment
`:4409-4411`: *"The class identity check goes by name: client plugin bundles do not share error-class identity."*):
`function activeSessionRefusal(reason) { if (!(reason instanceof Error) || reason.name !== "WorkspaceArchiveError") return
void 0; const { rpcError } = reason; return rpcError.code === "workspace/session-active" ? rpcError.details.activity : void
0; }` — gate on `error.name` + `error.rpcError.code`, never `instanceof` a host class.

## 4. Exact sidebar re-render mechanism after a session disappears (Q4)

Verified chain, no client refresh call involved: (1) host disposes the session → `ctx.on('session/disposed', ...)` →
`ctx.emit('api-session/removed', session.id)` (`dsh-api-session-controller\lib\types\index.js:242-244`; declared
`lib\typert.host.js:3181-3183`); (2) `dsh-api-remotes` forwards it (allowlisted,
`dsh-api-remotes\lib\types\remote-events.js:18`; README:43); (3) client receives it via
`ctx.remote.$on("api-session/removed", (sessionId) => sessions.handleSessionRemoved(sessionId))`
(`dsh-api-session-controller\lib\client.js:3618`); (4) `handleSessionRemoved` (`manager.js:593`) →
`recordMutation({ kind: 'remove', sessionId })` (`manager.js:500`) → `applyMutation` filters the summary
(`manager.js:720-767`) → `notifier.markDirty()`; (5) `Notifier` batches a microtask, rebuilds `listSnapshotCache`, notifies
listeners (`...\sessions\notifier.js`); (6) `ClientSessions.projectList()` re-projects into the observable store
(`service.js:491-563`) → `this.list.set({ ids, byId, phase, projectionsBySession })`; (7) React re-renders:
`UiWorkspaceService`'s `this.sessions.list.subscribe(reconcile)` (`client.js:917`) plus the `useSessions` subscriptions in
`WorkspaceBrowser` (`client.js:2799`) fire and the row disappears. No projection revision counter on this path.

`sessions.refresh()` status: real (`service.js:253` → `manager.js:319`), single-flight, re-pulls `remote.session.list({})`
and replaces the baseline; the shipped sidebar never calls it; it folds racing removals (`manager.js:337` comment — *"A
removal supersedes running observed in the pull, including after re-addition."*). **Caveat:** it prunes only ids absent from
`session.list`, whose source is `ApiSessionList.list` → `sessionQuery.listSessions`
(`dsh-api-session-controller\lib\types\list.js`). If the host still returns the record, `refresh()` keeps the row.

## 5. `dsh-client-modules` external client-plugin contract (Q5)

From `dsh-client-modules\README.md` (144 lines) + installed manifests:
- A browser plugin declares `dsh.client` (`platform: 'web'`) in `package.json`, exports a `./client` bundle, and lists
  non-baseline module requests under `dsh.client.external`; the host serves each declaration under `/plugins`, ordered so
  dynamic providers load before consumers. `<id>/client` and the bare id resolve to the same exports; bundles execute
  lazily (running a bundle only registers a factory; side effects run at materialization). The shell seeds a frozen
  `PLATFORM_MODULES` table (React, Cordis, static UI libraries); composition rejects malformed requests, missing suppliers,
  self-requests, and synchronous request cycles; type-only imports are erased. `pnpm run build` must have produced each
  `lib/client.js` before launch (a missing bundle fails activation loudly). Live composition: enabling a plugin adds its
  Loader entry, disabling removes it; HMR swaps a changed row to a revisioned combo URL.
- Bundle contract: exports `apply(ctx)` and optionally `inject` — every in-tree client bundle ends
  `exports.apply = apply; exports.inject = inject;` (`dsh-client-ui-workspace\lib\client.js:4419-4420`). `inject` lists
  service keys guaranteed present before `apply` runs (e.g. `['slots','sessions','workspaces',...]`); `apply` may be async
  and owns teardown via `ctx.effect(...)`.
- DOM: no ban stated, and dsh-cost-meter's client uses `document.addEventListener`, `window.addEventListener`,
  `document.hidden`. Extension UI goes through `ctx.slots.register({ name, id, locale, inject, store?, children? },
  Component)`, whose components receive reactive framework props (`useSessions`, `useWorkspaces`, `renderSlot`, `t`, …).
- Manifest evidence: `dsh-cost-meter\package.json` → `exports { ".": "./lib/index.js", "./client": "./lib/client.js",
  "./typert": "./lib/typert.host.js" }`, `dsh.client = { platform: "web" }`; `dshmarket\package.json` →
  `exports { "./client": "./client/client.js" }`, `dsh.client = { inject: ["@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-theme"], platform: "web" }` (proving `dsh.client.inject`
  is a legal baseline-module request declaration).

## HOW TO REFRESH THE SIDEBAR AFTER A HOST-SIDE DELETE (verified)

1. **Make the host actually remove the session.** No shipped remote deletes a session
   (`dsh-api-session-controller\lib\typert.remote-client.js` has none; persistence
   `dsh-session-persistence-jsonl\lib\index.js` exposes no file-delete API). Register your own host face (`./typert`
   consumed by `dsh-typert-loader` → `TypertRegistry.register`; `@Remote` method via `TypertRemoteService` /
   `bindTypertRemote`; strict codecs only) and remove the record so `sessionQuery.listSessions` stops returning it.
2. **Emit the removal on the host** by disposing the session (`dsh-api-session-controller\lib\types\index.js:242-244`):
   forwarded (`dsh-api-remotes\lib\types\remote-events.js:18`), consumed at
   `dsh-api-session-controller\lib\client.js:3618`, which prunes `sessions.list` — the row disappears with no plugin-side UI
   work.
3. **From the client, call your namespace** (`ctx.get("remote.<namespace>")`, per `dsh-cost-meter\lib\client.js` line 6) and
   unwrap `RemoteResult` (`if (!result.ok) throw new Error(result.error.message);`, as in
   `dsh-client-ui-workspace\lib\client.js:4148-4152`).
4. **Optionally resync:** `ctx.get("sessions").refresh()` — real API (`service.js:253` → `manager.js:319`), single-flight,
   promise-returning, safe to await. A race-correctness net, **not** what makes the row vanish.
5. **Feedback:** the ui-workspace toast store is private; register your own `shell.overlay` slot + snapshot toast store and
   render `Toast` with `{ text, tone, holdMs, actions, icon, onDone }` (mirror `client.js:4133-4140`, `:4390-4396`);
   classify host failures by `error.name` + `error.rpcError.code` (`client.js:4413-4417`).
6. **If the row survives**, the cause is host-side: the record is still in `session.list`'s source (`ApiSessionList.list`,
   `dsh-api-session-controller\lib\types\list.js`). Neither `refresh()` nor any client-only call can hide it — `projectList()`
   (`service.js:491-563`) overwrites `sessions.list` wholesale.

**UNVERIFIED:** (a) whether a plugin can replace/monkey-patch the `sessions` service (`reflect.provide('sessions', this,
undefined)` at `service.js:186`); (b) whether the primitives `Toast` specifier resolves from a third-party bundle's frozen
module table; (c) whether a plugin may dispose another session (the emission source was read; the API a plugin would call to
trigger disposal was not).
