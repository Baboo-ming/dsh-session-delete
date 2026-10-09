# R2 — DSH host plugin API for a third-party `deleteSession(sessionId)` pipeline

Ground truth: the extracted shipped bundle at `D:\AI_Work\开发\删除会话插件\.ref\dsh\node_modules\@deepseek-ai\`
(every citation below is `<package>\lib\index.js:line` relative to that root), correlated with live state
under `C:\Users\ming\.dsh\`. Non-source claims are marked **UNVERIFIED**.

This repo already carries the scaffold: `package.json` (`dsh-session-delete`, `dsh.bundle.patch: ./cordis.patch.yml`),
`cordis.patch.yml` (`- insert: - id: session-delete`), `lib/core/{paths,scan,ledger,pipeline}.js`,
`tests/core.test.js`. **`lib/core/paths.js` matches the host formulas verified below line-by-line.**
Client-refresh research: `docs/research/r3-client-store-refresh.md`.

## 1. Host plugin contract (cordis)

Plain ESM, named exports, **no default export**:

```js
export const name = 'dsh-session-delete'
export const inject = ['sessions','sessionPersistence','workspaceRegistry','agents','storageDomain']
export function apply(ctx, rawConfig = {}) { /* ... */ }
```

Precedent: `C:\Users\ming\.dsh\local-plugins\dsh-memory-evolve\lib\index.js:59` `export const name = 'dsh-memory-evolve'`,
`:64` `export const inject = [...]`, `:1543` `export function apply(ctx, rawConfig = {}) {`.

- `ctx` is the cordis context. A service listed in `inject` reads as `ctx.xxx`; an **undeclared** read
  throws `cannot get property 'xxx' without inject` (documented at memory-evolve `index.js:60-63`).
  Optional dependency: `ctx.get('name')` returns `undefined` instead of throwing (`index.js:68`,
  `session-orch.js:232-235`).
- Dynamic `ctx.inject(['agents'], cb)` was tried in memory-evolve and **abandoned** — the callback fired
  before the service existed so the tool never registered. Declarative `inject` is the reliable path;
  reserve `ctx.inject` for late/optional carriers (§1.3).
- Body idioms: `ctx.effect(() => { ...; return () => {/* dispose */} }, 'label')`, `ctx.on(event, handler)`,
  `ctx.tools.register(def)` (returns a disposer; wrap in `ctx.effect`). Real uses: memory-evolve
  `index.js:1343-1350`, `:1405-1407`.

### 1.1 Register your own service

Subclass cordis `Service` and call `super(ctx, '<serviceKey>')`; the key becomes `ctx.<serviceKey>` for
every other plugin. Precedents: `dsh-workspace\lib\index.js:373-375` `super(ctx, "workspaceRegistry")`;
`dsh-session\lib\index.js:1621` `super(ctx, "sessions")`;
`dsh-api-workspace-controller\lib\index.js:853` `super(ctx, "workspaceController", { namespace: "workspace" })`.

### 1.2 Native client-facing RPC (Typert Remote) — reachable from a third party

`dsh-typert-protocol\lib\index.js:159-172`:

```js
var TypertRemoteService = class extends Service {
  typertRemote;
  constructor(ctx, serviceKey, options = {}) {
    super(ctx, serviceKey);
    this.typertRemote = bindTypertRemote(this, this.name, options); // namespace = options.namespace ?? serviceKey
  }
};
```

`@Remote` (`:183-202`) is a standard method decorator recording a version-1 marker on the prototype
(`REMOTE_METHOD_DESCRIPTOR` `:135`, `mark()` `:248-268`; decorators require a public instance method,
`:240`). **The Gateway discovers these by source-mode scan — no compiler codegen needed:**
`dsh-api-gateway\lib\index.js:706-718` `collectSrcClaims()` walks `this.ctx.reflect.props`, skips
non-`service` entries, reads `Reflect.get(original, "typertRemote")`, and adds
`` `${namespace}/${candidate.exportName ?? candidate.method}` `` to the claimed endpoint set used by
`claimsEndpoint` (`:698-705`). Dispatch: `:726-736` `invoke` → `invokePrepared` resolves the descriptor
by `binding.namespace` (`:998-1014`) and `Reflect.apply(prepared.method, prepared.receiver, prepared.args)`.
Throw `RemoteError` (`dsh-typert-protocol\lib\index.js:11`) for business failures — first-party shape at
`dsh-api-workspace-controller\lib\index.js:297-309` (`new RemoteError("session/not-found", msg, {sessionId}, {cause})`).

**Client consumption is UNVERIFIED for third parties.** First-party clients receive a *generated*
namespace object: `dsh-api-workspace-controller\lib\types\client\model.js:8/33-35` `remote;` /
`constructor(remote) { this.remote = remote }` then `await this.remote.archiveSession({...})` `:128-132`.
That face comes from the Typert compiler (`dsh-typert-loader`), which a hand-written plugin does not run.
Options: hand-write the client caller against the same carrier, or use §1.3.

### 1.3 Proven fallback: own HTTP surface

`dsh-host-webserver\lib\index.js:158` `super(ctx, "webServer")`; contract `:171-184`:
`register(route)` where `route = { kind: 'exact' | 'prefix', path, handler }` → disposer; duplicate
`(kind, path)` throws `` `webserver: duplicate ${route.kind} route "${route.path}"` ``. Also
`registerUpgrade(route)` `:191-197` (exact path) and `registerFallback(handler)` `:206-211` (single owner).
Config `static Config` `:141-147`, `get port()` `:164`.

Working third-party precedent: memory-evolve `api.js:846`
`return ctx.webServer.register({ kind: 'prefix', path: '/memory-evolve', handler })`, installed via
`ctx.inject(['webServer'], (webCtx) => {...})` at `index.js:1761` — the file header comment says
`httpServer`, the real key is **`webServer`**. `api.js` is a hand-rolled `node:http` handler with
`readBody(req, maxBytes = 64*1024)`, `sendJson(res, status, body)` and `sameOriginGuard(req, body)`
(requires `Content-Type: application/json` and `Origin` host === `Host`). Slash commands:
`ctx.inject(['commands'], cb)` (`index.js:1843`).

**Recommendation:** expose `POST /session-delete/delete` through `ctx.webServer.register` (§1.3) — proven
end-to-end by a shipped third-party plugin, no codegen, and the sidebar update needs no client call (§5).
Use §1.2 only if the client half must call a native namespace.

## 2. Workspace ledger ("挂账")

**Service `ctx.workspaceRegistry`** — `dsh-workspace\lib\index.js:354-355`
`static inject = ["storageDomain", "sessionPersistence"]`, `:373-375` `super(ctx, "workspaceRegistry")`,
opened in `async [Service.init]()` `:377` via `this.ctx.storageDomain.open(workspaceDomainSpec)`.

### 2.1 Durable format (live: `C:\Users\ming\.dsh\storages\workspace.json`)

```jsonc
{ "unit": {"name":"workspace","version":2},
  "global": { "initialized": true, "defaultWorkspaceId": "…",
              "workspaceIds": ["…7 ids…"],
              "archivedSessionIds": ["session-7782db9c-8119-4264-aaa3-98e6a13f3385"],
              "pinnedSessionIds": [] },
  "tables": { "workspaces": { "<workspaceId>": { "path": "D:\\AI_Work\\…", "title": "…",
      "sessionIds": ["session-e5594e8a-…"], "createdAt": "…", "updatedAt": "…" } } } }
```

Domain `workspace`, **version 2** (`dsh-workspace\README.md:116`). `archivedSessionIds` /
`pinnedSessionIds` are registry-GLOBAL sets of plain id strings in order. `tables.workspaces[id].sessionIds`
is the ordered ownership account (= sidebar display order); the entity getter filters it to ids whose
canonical cwd still equals `record.path` (`:102`). Optional `global.pendingMutation`
`{operation:"create"|"delete", workspaceId}` supports crash recovery (`:703-744`).

**Atomicity:** writes go `WorkspaceEntity.mutate(fn)` `:173` → `host.table().update(id, …)` →
`dsh-storage-domain` `KvTableImpl.update` `:278` → `dsh-storage-json` `putRecord` `:461` →
`writeDocument` (tmp sibling + rename, `:26`). Record removal: `deleteRecord` `:467` =
`rm(join(dir, table, `${key}.json`), { force: true })`. **`dsh-atomic-write` is NOT involved** — its only
exports, `withFileLock` (`dsh-atomic-write\lib\index.js:188`) and `writeFileAtomic` (`:61`), are consumed
by `dsh`, `dsh-app-boot`, `dsh-config-editor`, `dsh-credentials-local`, `dsh-llm-deepseek`,
`dsh-plugin-manager` only.

### 2.2 Public API

Registry (`dsh-workspace\lib\index.js`): `create(path,title)` `:406`, `initializeDefault(resolveDirectory)` `:423`,
`get(id)` `:443`, `list()` `:452` (synchronous, durable order, returns **WorkspaceEntity[]**),
`delete(id)` `:467` (**deletes one workspace registration; keeps the directory and every session log**),
`insertBefore(id,beforeId)` `:477`, `get archivedSessionIds()` `:504`, `archiveSession(sessionId, options={})` `:524`,
`unarchiveSession(sessionId)` `:551`, `get pinnedSessionIds()` `:566`, `pinSession(sessionId)` `:576`,
`unpinSession(sessionId)` `:596`, `async sessionKnown(id)` `:612`, **`async stopSessionActivity(sessionId)` `:619`**,
`async resolveByPath(path)` `:635`, `async createCanonical(canonical,title,firstUse)` `:639`,
`async deleteKnown(id)` `:703`, `async readSessionHeader(id)` `:911`, `async setState(state)` `:933`.

Entity (`:76`; getters `path` `:90`, `title` `:93`, `createdAt` `:96`, `updatedAt` `:99`, `sessionIds` `:102`):
`setTitle(title)` `:105`, `attachSession(sessionId)` `:111`, `insertSessionBefore(sessionId,beforeSessionId)` `:130`,
**`detachSession(sessionId)` `:148`**, `status()` `:154` (`"ok" | "missing-dir"`), `mutate(fn)` `:173`.

**`detachSession` is the only ledger-removal primitive**, body `:148-152`: `await this.mutate(record =>
record.sessionIds.includes(sessionId) ? {...record, sessionIds: record.sessionIds.filter(id => id !== sessionId)}
: record)`. **No `forgetSession` / `removeSession` / `deleteSession` exists** on registry or entity.

### 2.3 Archive semantics (why stage 4 is separate)

`archiveSession` `:524-538`: returns immediately if already archived; throws `WorkspaceUnknownSessionError`
when `!await this.sessionKnown(id)`; unless `options.stopActivity === true`, runs the
**`workspace/session-activity` waterfall** and throws `WorkspaceActiveSessionError(id, activity)` when any
provider reports activity; then appends `id` to `archivedSessionIds` and filters it out of
`pinnedSessionIds`; then, if `stopActivity === true`, awaits `stopSessionActivity(id)`.
**Archiving never touches `sessionIds`** — the slot survives so unarchive restores position
(`README.md:99/116/174`). Errors: `WorkspaceUnknownSessionError` `:290`, `WorkspaceActiveSessionError` `:307`
(field `.activity`), `WorkspaceArchivedSessionPinError` `:322`, `WorkspaceMoveInvalidError` `:64`,
`WorkspaceOrderInvalidError` `:334`.

## 3. Session registry, lifecycle, and what stops running work

### 3.1 Live store

**`ctx.sessions`** — `dsh-session\lib\index.js:1596` `var SessionStore = class extends Service`,
`:1621` `super(ctx, "sessions")`. Public: `registerMessageProjection(projection)` `:1611`,
`create(id, options)` `:1653`, `prepare(id, options)` `:1680`, `enter(session)` `:1734`,
`detachEntered(entry)` `:1766`, `announce(session)` `:1781`, `emitDisposed(entry)` `:1805`,
`async flush(session)` `:1831`, `liveEntryFor(session)` `:1850`, `get(id)` `:1860`, `list()` `:1867`,
`fork(source, boundary, childSessionId)` `:1886`.

- `create()` `:1653-1660` = `prepare()` + `ctx.effect(function*(){ yield this.enter(session); this.announce(session) }, "sessions.create()")`.
  **In-memory lifetime is owned by the creating fiber**: disposing it removes the session and fires `session/disposed`.
- `enter()` `:1734-1763` rejects a duplicate id (`session "<id>" already exists`) or an already-attached
  session, then `this.store.set(id, entry)` + `attachments.set(session, entry)`.
- **`detachEntered(entry)` `:1766-1773` is the drop primitive**: `entry.detachRequested = false; if
  (this.store.get(entry.id) !== entry) return; this.store.delete(entry.id); attachments.delete(entry.session);
  if (entry.announced) this.emitDisposed(entry);` — idempotent (the identity guard makes a later
  fiber-driven detach a no-op, so `session/disposed` fires exactly once). `entry` is publicly reachable via
  `ctx.sessions.liveEntryFor(session)`.
- Events: `session/created` `:1791`, `session/disposed` `:1811`, `session/event` `:1468`,
  `session/flush` `:1837`, plus `session/end-seed` `:112`,`:927`, `session/title` `:113`, `session/title-llm-request` `:114`.
- **No public `delete`/`remove` on the store.**

### 3.2 Stopping running work — the two capability events

`dsh-workspace\README.md:101`; dispatched at `dsh-workspace\lib\index.js:529` (`ctx.waterfall`) and `:621` (`ctx.parallel`):

- `'workspace/session-activity'(request: {sessionId}, next: () => Promise<readonly SessionActivity[]>): Promise<readonly SessionActivity[]>`
- `'workspace/session-stop'(request: {sessionId}): Promise<void> | void`

Machine-readable mirrors: `dsh-tool-cordis\lib\index.js:4324-4326` / `:4332-4334` and
`dsh-tool-cordis\lib\types\api-catalog.js:3546/3552/3657/4335/4480/7952`.

| package | activity (running work) | stop |
|---|---|---|
| `dsh-agent` | the running `turn` family (`:27`) | cancels that turn (`:33`) |
| `dsh-jobs` | owned running/stopping jobs (`:20`) | kills each (`:32`) |
| `dsh-subagent` | running subagent descendants (`:68`, `:2244`) | cancels each (`:76`, `:2253`) |
| `dsh-schedule` | active reminders (`:191`, `:2682`) | clears them (`:202`, `:2694`) |

`dsh-schedule` is **not mounted** in the desktop profile; `dsh-desktop-host\lib\index.js:154,170` only
consumes the waterfall. A composition without providers deletes freely.

`ctx.workspaceRegistry.stopSessionActivity(sessionId)` `:619-633` is the safe public wrapper: it runs
`ctx.parallel('workspace/session-stop', {sessionId})` and **logs, never rethrows**, a provider failure
(`AggregateError.errors` or single error → `ctx.logger.warn("workspace: stopping session '<id>' for archive failed: …")`).

### 3.3 Archive call chain (reference for mirroring the guard)

`dsh-client-ui-workspace\lib\client.js:4224-4225` `stopAndArchiveSession: async (sessionId) => { await uiWorkspace.archiveSession(sessionId, { stopActivity: true }); notify({kind:"stoppedAndArchived", sessionId}) }`
→ `:4196-4214` `archiveSession` — on rejection reads `activeSessionRefusal(reason)`; a non-`undefined`
activity payload opens the confirmation modal (`archiveRequest.set({sessionId, displayTitle, activity})`)
→ `:861-862` `async archiveSession(sessionId, options = {}) { await this.workspaces.archiveSession(sessionId, options) }`
→ `dsh-api-workspace-controller\lib\types\client\model.js:128-132`
`await this.remote.archiveSession({ sessionId, ...(options.stopActivity === true ? { stopActivity: true } : {}) })`
→ Remote `@Remote('archiveSession')`, wire request `WorkspaceArchiveSessionRequest { readonly sessionId: SessionId;
readonly stopActivity?: boolean }` (`dsh-api-workspace-controller\lib\typert.host.js:618/625/662`, zod `:33`)
→ `dsh-api-workspace-controller\lib\index.js:297-309` (`WorkspaceUnknownSessionError` → `RemoteError("session/not-found")`;
`WorkspaceActiveSessionError` → `RemoteError("workspace/session-active", msg, {sessionId, activity})`; returns
`{ archivedSessionIds: [...] }`) → `dsh-workspace\lib\index.js:524-538`. Keyboard: `client.js:193`
`register("session.archive", …, "KeyA", ["primary","shift"], …)`.

The modal's activity payload is the *failure* of the first call, not a separate query. `ArchivedSessionGate`
(`dsh-api-session-controller\lib\types\archived-session-gate.js`, 51 lines;
`inject: ['agents','sessions','workspaceRegistry']`) rejects every `agent/pre-step` whose session — including
`origin === 'subagent'` ancestors — is in `archivedSessionIds`, which is why a durable archive entry alone
blocks later wakes.

### 3.4 Controller RPC surfaces contain no delete

`dsh-api-session-controller\lib\index.js:2816-2827` `static inject = ["agentDefaultModel","agents","attachments",
"fileUploads","fs","llm","sessions","sessionProjections","sessionQuery","typert","workspaceRegistry"]`,
`:2846` `super(ctx, "sessionController", { namespace: "session" })`. Methods: `promote` `:2899`,
`resolveAgent` `:2930`, `inspect` `:2939`, `async list` `:2954`, `search` `:2963`, `create` `:2971`,
`selectModel` `:2979`, `async initializeDefaultModel` `:2986`, `modelCatalog` `:3002`,
`canOpenWorkspacePath` `:3009`, `workspaceDesktop` `:3016`, `async openWorkspacePath` `:3031`,
`async workspacePathApplications` `:3051`, `async verifyDesktopPath` `:3062`, `rename` `:3077`,
`fork` `:3087`, `prompt` `:3096`, `attachment` `:3105`, `updateQueue` `:3113`, `cancel` `:3121`,
`page` `:3130`, `follow` `:3140`, `async projections` `:3149`, `control` `:3183`. **No `delete`/`remove`.**
Same for `ctx.workspaceController` (`dsh-api-workspace-controller\lib\index.js:865-952`).

## 4. Disk artifacts and what deletes them

### 4.1 Session log — the only real payload

Backend `ctx.sessionPersistence`, class `JsonlSessionPersistence`
(`dsh-session-persistence-jsonl\lib\index.js:2372`), `static Config = z.object({ root: z.string().required(),
compression: JsonlCompressionSchema })` `:2374-2377`, `this.root = resolve(config.root)` `:2400`. Desktop
profile config: `root: !!js dshHomePath('sessions')` → `C:\Users\ming\.dsh\sessions`.

```
<root>/<projectKey(cwd)>/<encodeSegment(id)>/session.v4.jsonl.zstd
```

- `encodeSegment(raw)` `:851-863`: `''` throws `cannot encode an empty path segment`; `.` → `~002E`;
  `..` → `~002E~002E`; safe `[A-Za-z0-9._-]` literal; everything else (including `~`) becomes `~` +
  uppercase hex, **4-digit minimum** (`padStart(4,"0")`).
- `projectKey(cwd)` `:873-892`: `''` **throws** `cannot encode an empty project path`; `/`, `\`, `:`
  collapse a run to one `-`; other unsafe units use the same `~XXXX` escape; leading dashes stripped;
  `` `--${(readable || "root").slice(0,251)}--` `` (so `cwd = "/"` → `--root--`).
- `projectDir(root, cwd)` `:900-903`: `cwd === void 0` → `join(root, "_no-cwd")`, else `join(root, projectKey(cwd))`.
- `sessionDir(root, cwd, id)` `:914`; documented `:904-907` as "**the directory owned by one session and
  available for future session-local artifacts**".
- `logSuffix(compression)` `:745-747` = `` `.jsonl${compressionSuffix(compression)}` ``; `:748-750` `.zstd`
  or `''`. `generationLogFilename(version, compression)` `:759-761` (version 0 keeps the suffix-only name,
  later generations carry lowercase `vN`); `parseGenerationLogFilename` `:770-774`. `logPath` `:937`,
  `generationLogPath` `:926`. **Several generation files can coexist in one directory → delete the
  directory, not a filename.**

Live confirmation: `C:\Users\ming\.dsh\sessions\` holds project dirs such as
`--D-AI_Work-~5F00~53D1-~5220~9664~4F1A~8BDD~63D2~4EF6--` (this project) and
`--C-Users-ming-Documents-deepseek-harness-default-workspace--`, each with one directory per session
containing a single `session.v4.jsonl.zstd` (335 B – 1.27 MB).

Header line 1: `{type:"session", version, id, createdAt, delegationDepth, cwd?, parentSession?, isSeeded,
origin?, agentPreset?}` — `HEADER_REQUIRED_KEYS = ["type","version","id","createdAt","isSeeded","delegationDepth"]`
`:775-782`, `HEADER_OPTIONAL_KEYS = ["cwd","parentSession","origin","agentPreset"]` `:783-788`. Event lines via
`eventLine`/`eventLines` `:954`/`:946`, contiguous `seq` from 0 (`assertContiguous`,
`dsh-session-persistence\lib\index.js:229`). `SESSION_FORMAT_VERSION` = **4** (`dsh-session\lib\index.js:1700`).

### 4.2 Backend API — and the absence of delete

`create(header, options)` `:2429`, `open(id, access, options)` `:2452` (`access` = `"read"|"write"`),
**`stat(id, options)` `:2534`** → `{header, revision, sizeBytes?}` or `undefined` (pending `:2539-2542`,
materialized `:2550-2554`, ENOENT → `undefined` `:2557`), **`list(options)` `:2567`** → one snapshot per
stored session (pending + artifacts, order not promised), **`locate(meta)` `:2414-2419`** →
`{ kind: "jsonl", path: logPath(this.root, meta.cwd, meta.id, this.compression) }`,
`requireStoredLog(id, signal)` `:2600`; handles expose `append`/`flush`/`close`.
`dsh-session-persistence\lib\index.js` (269 lines, the whole file) is only
`var SessionPersistence = class extends Service { identity = Symbol("sessionPersistence"); constructor(ctx)
{ super(ctx, "sessionPersistence") } }` plus errors/validation (`SessionPersistenceNotFoundError`,
`SessionAlreadyExistsError`, **`SessionAlreadyOwnedError`**, `SessionReadOnlyError`, `SessionOwnershipLostError`,
`SessionHandleClosedError`, `SessionPersistenceCorruptionError`, `SessionFormatUnsupportedError` (has
`.location`), `sessionFormatVersionRefusal`, `validateStoredEvents`, `assertContiguous`, `assertStoredId`,
`assertVersion`, `materializeCreateHeader`, `materializeAppendBatch`).

**No delete/remove/unlink/trash in either persistence package.** Grepping `\btrash\b|unlink|rmSync|rmdir|fsp\.rm`
over the jsonl backend returns only a comment about lock-file inodes (`:628`). Ownership matters:
`open(id, "write")` takes an in-process claim (`SessionAlreadyOwnedError`), so **never delete a session whose
write handle is live**.

### 4.3 Projection cache — a storage-domain row

`session_projcache` is a domain (`defineDomain` `dsh-session-projection-cache\lib\index.js:90`,
`tables: { sessions: domainTable(checkpointRecord) }` `:101`), service `ctx.sessionProjectionCache` (`:147`,
`static inject = ["storageDomain","sessionProjections","sessions"]` `:138-142`). Public: `recordFor(id, expected)` `:169`,
`cachedSnapshot(meta, keys)` `:193`, `hydratePrepared(session, events)` `:248`, `async write(session)` `:266`,
`coldSnapshot(meta, inheritedEventCount, events)` `:285`, `put(id, identity, rows)` `:349`; `installWritePath()` `:293`
listens `session/event`, `session/created`, **`session/disposed`** (flushSoft + markClean + `dirty.delete`).
**No delete method is exposed**, but the domain is reachable:
`ctx.storageDomain.get('session_projcache')?.table('sessions').delete(sessionId)`. Live files:
`C:\Users\ming\.dsh\storages\session_projcache\sessions\<sessionId>.json` (18 files, 4133–94156 B), written by
`dsh-storage-json` as `<dir>/<table>/<key>.json` (`:395`) with `deleteRecord` = `rm(..., {force:true})` (`:467`).

`ctx.storageDomain` (`DomainFacility`, `dsh-storage-domain\lib\index.js:455` exports
`{ Config, DomainError, DomainFacility, apply, defineDomain, descriptorOf, domainTable, inject, name }`):
`async open(spec)` `:355` — **throws `DomainError("already-open", "domain '<name>' is already open")` `:356`**
when the name is taken, so a plugin must use `get(name)` `:406` (untyped runtime; `.table(name)` still works)
rather than re-opening. Table ops `get/entries/keys/size/put` `:257`, `delete` `:264`, `update` `:278`; every
mutation emits `ctx.emit("domain/changed", {domain, table, key, operation: "put"|"deleted", value?})` `:216`,
which `dsh-api-workspace-controller`'s `follow(signal)` stream forwards (`lib\index.js:54`;
`operation === "deleted"` at `:134`).

### 4.4 Everything else on disk

- **Attachments — do NOT delete.** `dsh-attachment-local\lib\index.js` roots at `DSH_HOME/attachments/v1` and
  stores CONTENT-ADDRESSED immutable objects at `join(root, "objects", sha256.slice(0,2), sha256)`
  (`normalizedImagePath` `:296-298`, `stageImmutableObject` → hard-link `publishImmutableObject` `:433`).
  Objects are shared across sessions; there is no per-session attachment directory.
- **Query index — nothing to clean.** `dsh-session-query-sqlite` is configured `{path: ':memory:', openAt: never}`
  in the desktop profile; its private `_deleteSession(source, id)` `:760` runs
  `DELETE FROM persisted_docs WHERE session_id = ?` etc., driven by an observation diff `:656-688`.
- **Other plugins' ledgers.** `C:\Users\ming\.dsh\storages\cost-meter\ledger.json` (213 KB, plus
  `ledger.json.native-search-coverage.json`) belongs to third-party `dsh-cost-meter`; memory-evolve keeps its
  own store and `sessions.json`. **No host API purges another plugin's per-session data** — accept orphan rows.
- **`C:\Users\ming\.dsh\session-manager-trash\`** exists with only an empty `_metadata\` directory. Grepping
  every shipped `*.js` for `session-manager-trash` finds **nothing** — no package creates, reads, or writes it.
  Orphan convention with no API (**UNVERIFIED** origin); do not rely on it.

## 5. Broadcast to clients

Host→client events are an **explicit allowlist**: `dsh-api-remotes\lib\index.js:17-126`
`const API_REMOTE_FORWARDED_EVENTS = [...]` (runtime mirror `dsh-api-remotes\lib\types\remote-events.js:15-19`),
including `{event:"api-session/added", mode:"emit"}` `:31`, `{event:"api-session/removed", mode:"emit"}` `:39`,
`{event:"api-session/activity", mode:"emit"}` `:27`, `{event:"api-session/status", mode:"emit"}` `:43`,
`{event:"api-session/error", mode:"emit"}` `:35`. Registration: `:131` `const inject = ["typertGateway"]`, `:134`
`ctx.effect(() => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }), …)`;
`remoteEventSource(ctx)` `:137-163` binds each allowlisted name with `ctx.on(event, …)` and pushes
`{event, args}` frames through `RemoteEventQueue` `:165`.

Signatures (`dsh-api-session-controller\lib\typert.host.js:3112-3210`; catalog mirror
`dsh-tool-cordis\lib\types\api-catalog.js:3804-3838`): `'api-session/added'(summary: SessionSummary): void`,
**`'api-session/removed'(sessionId: SessionId): void`**, `'api-session/activity'(sessionId: SessionId, updatedAt: number): void`,
`'api-session/status'(sessionId: SessionId, running: boolean): void`, `'api-session/error'(...)`.

Host emitters, `dsh-api-session-controller\lib\index.js:2873-2897`: `ctx.on("session/created", session =>
ctx.emit("api-session/added", this.listState.summaryFor(session)))`, **`ctx.on("session/disposed", session =>
ctx.emit("api-session/removed", session.id))`**, `ctx.on("agent/created"|"agent/disposed", publishAgentAvailability)`,
`ctx.on("agent/status", …)`, `ctx.on("agent/error", …)`, `ctx.on("session/event", (session, event) => { …
ctx.emit("api-session/activity", session.id, event.time) })` (mirrored at
`dsh-api-session-controller\lib\types\index.js:240-266`). Client receivers:
`dsh-api-session-controller\lib\types\client\index.js:27-32` `ctx.remote.$on('api-session/removed', sessionId =>
sessions.handleSessionRemoved(sessionId))` (plus `added`/`status`/`activity`); also `lib\client.js:3615-3624`.

**Conclusions:**

- If the session **was live**, `ctx.sessions.detachEntered(ctx.sessions.liveEntryFor(session))` fires
  `session/disposed`, which the session controller already relays as `api-session/removed`. Nothing extra.
- If it was **not live** (the common case for an old sidebar row), nothing fires — the plugin must call
  **`ctx.emit('api-session/removed', sessionId)`** itself. The name and payload are already allowlisted: no
  registration, no gateway access.
- `sessions.refresh()` is **not required** but is cheap belt-and-braces: the client service exposes
  `refresh() { return this.manager.refreshList() }`
  (`dsh-api-session-controller\lib\types\client\sessions\service.js:250-254`) and `refreshProjections(sessionId)` `:246`.
  It re-pulls the authoritative baseline, repairing drift the event left behind. It is client-side, so a host
  plugin can only trigger it through its own HTTP/RPC surface (see `docs/research/r3-client-store-refresh.md`).
- Never touch `ctx.connection` (`dsh-client-connection\lib\index.js:566` `super(ctx, "connection")`) or
  `ctx.typertGateway` directly — both sit below the allowlist. The browser-side `Notifier`
  (`dsh-api-session-controller\lib\types\client\sessions\notifier.js`, 98 lines) is a uSES batching store
  (`subscribe`/`markDirty`/`markFrameDirty`/`notifyNow`/`ensureFresh`/`flush`), **not** a host API.

## 6. Packaging and registration in a profile

Composition contract, `dsh-app-boot\lib\index.js:466-475`: a profile is `$DSH_HOME/profiles/<name>` holding a
`package.json` (out-of-tree plugin dependencies plus the manifest `dsh.profile` with its ordered `bundles`
list) and a `cordis.patch.yml` (the user's own patch layer, applied **after** every bundle layer). Bundles are
npm packages whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` (one file or an
ordered list); the tree is composed by applying each bundle's patch lists in `dsh.profile.bundles` order over
an empty entry list, then the profile's own patches, then launcher layers.

- `bundlePatchFiles(bundle)` `:495-499` — `patch` must be a string or a list of strings, else
  `dsh.bundle.patch must be a file path or a list of file paths`; `bundlePatchPaths` `:507-509` joins each
  against the bundle package dir.
- Resolution is two-anchor: a bundle name resolves first from the dsh installation, then from the profile
  directory; pnpm-managed entries in the profile's `node_modules` win (`:477-481`).
- `resolveProfileDir(name, home)` `:524-527`; `PROFILE_TEMPLATES` `:529-535`; `PROFILE_PATCH_TEMPLATE` `:558-562`
  (top-level YAML array, `!!js` allowed). `dsh-plugin-manager\lib\index.js:228` gates installability on
  `manifest.dsh?.bundle?.patch` being present.

**This repo already declares everything needed.** `D:\AI_Work\开发\删除会话插件\package.json`:

```json
{ "name": "dsh-session-delete", "type": "module", "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" },
           "bundle": { "patch": "./cordis.patch.yml" } } }
```

`D:\AI_Work\开发\删除会话插件\cordis.patch.yml`:

```yaml
- insert:
    - id: session-delete
      name: 'dsh-session-delete'
```

Its header comment states the operational rule: install with `dsh plugin --profile desktop add <path>`, or link
the package into the profile and add `dsh-session-delete` to `dsh.profile.bundles`; the bundle patch is then
applied automatically, so **do NOT insert this row again in the profile's own `cordis.patch.yml` (duplicate ids
crash the loader)**.

Reference: `C:\Users\ming\.dsh\local-plugins\dsh-memory-evolve\cordis.patch.yml` is the same shape
(`- insert: - id: dsh-memory-evolve / name: 'dsh-memory-evolve'`), and its profile wiring at
`C:\Users\ming\.dsh\profiles\desktop\package.json` is
`"dependencies": { …, "dsh-memory-evolve": "link:C:/Users/ming/.dsh/local-plugins/dsh-memory-evolve" }` plus
`"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dshmarket",
"dsh-cost-meter","billion-context","dsh-memory-evolve","@wisdoverse/dsh-skills-manager",
"@deepseek-ai/dsh-experimental-agent-team-profile"] } }` — the package NAME must appear in
`dsh.profile.bundles`, and a local plugin is wired with a pnpm `link:` dependency. Profile `pnpm-workspace.yaml`:
`packages: [.]`, `nodeLinker: hoisted`, `autoInstallPeers: false`.

**Current install state (verified on disk): `dsh-session-delete` is NOT in
`C:\Users\ming\.dsh\profiles\desktop\package.json`** (neither `dependencies` nor `dsh.profile.bundles`). A stale
backup `cordis.patch.yml.bak-1791509198400` in that profile ends with `- id: dsh-session-delete` +
`  disabled: true` — prior art for this id, and the reason a naive re-insert would collide.

**Remaining deployment steps:** (1) `link:` the repo into the profile and run pnpm install; (2) add
`dsh-session-delete` to `dsh.profile.bundles` **after** `@deepseek-ai/dsh-web-app`; (3) restart the host
(bundle patches are read at boot; only the profile `cordis.patch.yml` is hot-reloaded — `dsh-app-boot\lib\index.js:486-487`);
(4) confirm no leftover `- id: dsh-session-delete` row in the profile's own patch file.

## 7. Stage-by-stage implementation table

`ctx` is the plugin's cordis context. "MUST IMPLEMENT OURSELVES" = no host API exists.

| # | Stage | Concrete call |
|---|---|---|
| 1 | validate id | `await ctx.sessionPersistence.stat(id)` → `{header, revision, sizeBytes?}` or `undefined` (`dsh-session-persistence-jsonl\lib\index.js:2534`); `await ctx.workspaceRegistry.sessionKnown(id)` (`dsh-workspace\lib\index.js:612`). Detect liveness: `ctx.sessions.get(id)` (`dsh-session\lib\index.js:1860`) and `ctx.agents.roots()` (`agent.status` / `agent.session.id`, cf. memory-evolve `index.js:1817-1827`). Refuse when a write handle is live (`SessionAlreadyOwnedError`). Return the resolved **header** — `header.cwd` is required for the log path. |
| 2 | stop running work | `await ctx.workspaceRegistry.stopSessionActivity(id)` (`dsh-workspace\lib\index.js:619`) — runs `ctx.parallel('workspace/session-stop', {sessionId})` and logs instead of throwing. To *detect* first: `ctx.waterfall('workspace/session-activity', {sessionId}, () => Promise.resolve([]))`. One-shot alternative covering 2+4: `archiveSession(id, { stopActivity: true })`. Providers: `dsh-agent` turn, `dsh-jobs`, `dsh-subagent`; `dsh-schedule` is not mounted. |
| 3 | remove workspace ledger entry | `const ws = ctx.workspaceRegistry.list().find(w => (w.sessionIds ?? []).includes(id)); if (ws) await ws.detachSession(id)` (`WorkspaceEntity.detachSession`, `dsh-workspace\lib\index.js:148`). No registry-level API. **Do this before deleting the log**, while the header index still resolves the session path (the `sessionIds` getter filters on it, `:102`). |
| 4 | remove from archive set | `await ctx.workspaceRegistry.unarchiveSession(id)` (`:551`) — no existence probe, safe unconditionally; plus `await ctx.workspaceRegistry.unpinSession(id)` (`:596`). Both write via `setState` → `storageDomain` (atomic tmp+rename). |
| 5 | delete on-disk logs | `const meta = (await ctx.sessionPersistence.list()).find(s => s.header.id === id)?.header; const dir = path.dirname(ctx.sessionPersistence.locate(meta).path); await fs.rm(dir, { recursive: true, force: true })` (`locate` `:2414`; the directory is the session's own, `:904-907`, so this also covers older `vN` generations and the lock file). Then the projection row: `ctx.storageDomain.get('session_projcache')?.table('sessions').delete(id)` (`dsh-storage-domain\lib\index.js:264` → `dsh-storage-json\lib\index.js:467` `rm`). **MUST IMPLEMENT OURSELVES:** no `sessionPersistence.delete()` exists anywhere; no API purges other plugins' per-session data (`cost-meter/ledger.json`, memory-evolve store); shared content-addressed attachments must be left alone. |
| 6 | drop in-memory state | `const live = ctx.sessions.get(id); if (live !== undefined) ctx.sessions.detachEntered(ctx.sessions.liveEntryFor(live))` (`liveEntryFor` `:1850`, `detachEntered` `:1766`: store delete + attachments delete + `emitDisposed`). Idempotent via the identity guard, so a later fiber-driven detach is a no-op. **MUST IMPLEMENT OURSELVES** beyond the store: the session's own fiber is not ours and its teardown still runs; a never-live session has no in-memory state. The projection cache's dirty flag is handled by its own `session/disposed` listener (`dsh-session-projection-cache\lib\index.js:293`). |
| 7 | broadcast to clients | If stage 6 ran, `session/disposed` already produced `api-session/removed` (`dsh-api-session-controller\lib\index.js:2873-2897`) — nothing more. Otherwise **`ctx.emit('api-session/removed', sessionId)`** (allowlist entry `dsh-api-remotes\lib\index.js:39`; signature in `dsh-api-session-controller\lib\typert.host.js`, `'api-session/removed'(sessionId: SessionId): void`). Optional follow-up: the client half calls `sessions.refresh()` (`dsh-api-session-controller\lib\types\client\sessions\service.js:250-254`) after the host call returns. Do **not** touch `ctx.connection` / `ctx.typertGateway`. |

### Ordering and failure notes

1. Order: validate → stop → **detach ledger** → unarchive/unpin → drop memory → delete files → emit. Deleting
   files before the ledger detach can leave a dangling `sessionIds` entry whose `sessionPath` lookup no longer
   resolves (the entity's prune-on-mutate would drop it only on the *next* mutate).
2. **Independently degrading is safe:** stages 3, 4 and 5 are separate durable writes, so a partial failure
   leaves a consistent-but-incomplete state. Report each stage's outcome instead of aborting; the only hard
   precondition is stage 1.
3. For a **live** session, prefer refusing (or requiring explicit `force`) unless stage 2 actually reported
   activity and stopped it — a live session still owns a fiber, a write handle, and possibly running subagents
   whose own ledger entries none of these calls touch (the `dsh-subagent` providers detect, they do not clean up).
4. Global side effects not covered: `global.defaultWorkspaceId` names a workspace, not a session, so leave it;
   `archivedSessionIds` is global, so stage 4 must run even when stage 3 found no owning workspace.
