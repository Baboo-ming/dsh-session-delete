# R4 — Third-party local DSH plugin: packaging, registration, loading, install
Target: new plugin **`dsh-session-delete`** in `D:\AI_Work\开发\删除会话插件\`, installed into live profile `C:\Users\ming\.dsh\profiles\desktop\`.
Runtime: **DSH desktop `0.2.0-rc.2`**. Reference tree: `D:\AI_Work\开发\删除会话插件\.ref\dsh\` (`.ref\dsh\package.json` = `@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2).
## 1. `cordis.patch.yml` — schema and merge semantics
### 1.1 Real shipped examples
`dsh-memory-evolve\cordis.patch.yml` (complete):
```yaml
- insert:
    - id: dsh-memory-evolve
      name: 'dsh-memory-evolve'
```
`node_modules\dsh-cost-meter\cordis.patch.yml` → `- insert:` / `- id: cost-meter` / `name: dsh-cost-meter`
`node_modules\dshmarket\cordis.patch.yml` → `- insert:` / `- id: dsh-market` / `name: 'dshmarket'`
`node_modules\@wisdoverse\dsh-skills-manager\cordis.patch.yml` → `- insert:` / `- id: skill-manager` / `name: '@wisdoverse/dsh-skills-manager'`
Every working bundle patch is exactly one `insert` row; the row `id` is an **arbitrary label** (`cost-meter` ≠ `dsh-cost-meter`), while `name` is the **module specifier resolved to the package**. `disabled`/`config`/`inject` may also appear on an inserted row.
### 1.2 Entry schema
`.ref\dsh\node_modules\@deepseek-ai\cordis-plugin-include\src\index.ts:130-141`:
```ts
export interface PatchOptions {
  id?: string; insert?: EntryOptions[]; name?: string; config?: any
  group?: boolean | null; disabled?: boolean | null; inject?: any
  intercept?: any; isolate?: any; [key: string]: any
}
```
Two shapes: **insert** `{ insert: [entry,…], id?: <group id> }` (no `id` ⇒ appended at entry-list root; with `id` ⇒ pushed into that group's `config` array), and **override** `{ id, name?, …overrides }` (must carry `id`).
Validation: `userPatchesSchema`/`entryListSchema` = `yaml.JSON_SCHEMA.extend(JsExpr)`, where `JsExpr` is a `yaml.Type` for `tag:yaml.org,2002:js` (`cordis-plugin-include\src\index.ts:9-25`) — `!!js` scalars become expression nodes evaluated at activation. The file must be a **top-level YAML array of mappings**; else `dsh-app-boot\lib\index.js:3559-3571` throws `` `${binName}: ${label} ${file} must be a top-level YAML array of loader patch entries` `` or `` `${binName}: ${label} entry ${index + 1} in ${file} must be a mapping (a loader patch entry)` ``.
### 1.3 Merge algorithm
`cordis-plugin-include\src\index.ts:57-127`, mirrored verbatim in `dsh-app-boot\lib\index.js:61-110`:
- `if (!patches?.length) return [...data]; data = structuredClone(data);` — clone so a removed/changed patch can revert on config hot-reload.
- `buildMap(entries)` indexes every `entry.id` (recursing into `entry.group && Array.isArray(entry.config)` children).
- insert + `id`, target missing → warn `patch insert: entry %C not found`; target not a group → `patch insert: entry %C is not a group`; else `target.config.push(...insert)`.
- insert without `id` → `data.push(...insert)`; then `buildMap(insert)` so a **later patch in the same list** can target what this one added.
- override without `id` → warn `patch: id is required for non-insert patches`; target missing → `patch: entry %C not found`; `name` mismatch → `patch: name mismatch for %C (expected %C, got %C), skipping`; else `for (const [k,v] of Object.entries(overrides)) { if (k==='id') continue; target[k]=v; }`.
- **`config` REPLACES the whole config object — no deep merge.** Restate every field you keep.
### 1.4 Layer order (definitive)
`dsh-app-boot\lib\index.js:1023-1034` `readProfilePatches`:
```js
const patches = structuredClone([
  ...profile.layers.flatMap((layer) => layer.patches),   // bundle layers, in dsh.profile.bundles order
  ...initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath) ?? [],   // profile cordis.patch.yml
  ...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [],         // ~/.dsh/cordis.patch.yml — OUTRANKS profile
  ...context.overlays                                                                     // --patch files
]);
```
Then `resolveTelemetryPatch` may push `{ id: "session-telemetry-otel", disabled: true }` (`:998`). `composeEntries(layers)` (`:989-994`) = `applyEntryPatches([], structuredClone(layers.flat()), warn)` — the same call `boot()` makes, so dumps cannot drift.
Module resolution is two-anchor (`:462-483`): *"a bundle name resolves first from the dsh installation (the launcher's own package), then from the profile directory. Pnpm-managed entries in the profile's `node_modules` resolve first."* Missing bundle → `resolveBundleDir` throws `` `${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)} from the dsh installation or ${profileDir}; run 'dsh plugin --profile ${basename(profileDir)} install' if its dependency is not installed` `` (`:901-907`). No `dsh.bundle` → `` `${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json` `` (`:920-954`). ANY per-bundle throw makes that bundle **skipped, not fatal**, reported once per start by `reportSkippedBundles`: `` `${binName}: skipping profile bundle ${JSON.stringify(packageName)}: ${reason}` `` (`:515-517`).
`bundlePatchFiles` throws `"dsh.bundle.patch must be a file path or a list of file paths"` (`:495-499`). `loadOptionalPatches` returns `undefined` only on ENOENT — *"an unreadable, unparsable, or non-array file throws — a present patch file that cannot apply is a misconfiguration and must fail loud at boot, never be silently skipped"* (`:3497-3507`); same for `loadOverlayPatches` (bundle patches and `--patch`, `:3527-3535`). `anchorInsertedPluginNames` (`:3537-3545`) rewrites an inserted `name` that is absolute or starts `./`/`../` into a `file://` URL relative to the patch's directory.
### 1.5 `cordis.yml` is NOT the user layer
`cordis.yml` is the **generated profile root**, `PROFILE_ROOT_FILENAME = "cordis.yml"` (`@deepseek-ai/dsh\lib\profile-boot-BZ2ZjNWi.js:127`), template literally `[]` with header *"The tree is composed as patches: each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any --patch overlays. **Edit cordis.patch.yml, not this file.**"* (`:121-124`). `C:\Users\ming\.dsh\profiles\desktop\cordis.yml` is 1258 lines only because a `dsh --dump-config` run overwrote it; its tail rows (`dshmarket`, `dsh-cost-meter`, `billion-context`, `dsh-memory-evolve`, `@wisdoverse/dsh-skills-manager`) are **output, not input**. The real user layer is `cordis.patch.yml` (827 B, 4 id-targeted overrides, no inserts) — §4.4.
### 1.6 Programmatic enable/disable
`dsh-plugin-manager\lib\types\patch.js:13-49` `writePluginEnabled(filename, id, name, enabled)` reads the **profile** patch (ENOENT → `'[]\n'`), parses comment-preservingly, requires `isSeq(contents)` else `throw new Error('Profile patch must be a YAML sequence')`, finds `findLast(item => isMap(item) && getIn([index,'id'])===id && !item.has('insert') && (!expectedName || expectedName===name))`, sets `disabled` or appends `{ id, disabled: !enabled }`, `writeFileAtomic(..., { mode: 0o600 })`. ⇒ enable/disable only touches **non-insert** entries of the profile patch. To disable a bundle's row, add your own id-targeted `{ id, disabled: true }` override; never edit the bundle's file.
## 2. `package.json` requirements for a local plugin
### 2.1 Minimal working shape (proven in production)
`C:\Users\ming\.dsh\local-plugins\dsh-memory-evolve\package.json` — smallest plugin that mounts host + browser halves:
```json
{
  "name": "dsh-memory-evolve", "version": "0.1.0", "private": true, "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "scripts": { "test": "node --test 'tests/*.test.js'", "build": "node scripts/build.mjs" },
  "license": "MIT",
  "dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" },
           "bundle": { "patch": "./cordis.patch.yml" } }
}
```
No `engines`, no `peerDependencies`, no `dsh.compatibility` — **sufficient** for 0.2.0-rc.2.
### 2.2 Field-by-field
| Field | Required | Meaning / enforcement |
|---|---|---|
| `name` | **yes** | Must equal the patch row's `name`, the loader entry name, and the client bundle's `__ModuleLoader__` `id` (§2.4). |
| `type: "module"` | recommended | Host half is ESM; `dsh-cost-meter`/`dshmarket`/`dsh-plugin-manager` use it. `@wisdoverse/dsh-skills-manager` puts `main` at the package root (`"main": "index.js"`), so `lib/` is convention, not a rule. |
| `main` | yes | Host entry loaded by the Loader. |
| `exports["."]` | yes in practice | `clientExportOf` reads `exports["./client"]`; the rich `{ "default": "./lib/index.js" }` form is also accepted. |
| `exports["./client"]` | **required iff `dsh.client`** | `dsh-client-modules\lib\index.js:171-181`: string or `{default: string}`, else `` client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default ``. Declared client with no export → `` client-modules: ${packageName} declares dsh.client but exports no "./client" bundle `` (`:701-731`). |
| `dsh.bundle.patch` | for a profile bundle | `dsh-plugin-manager\lib\index.js:228`: `manifest.dsh?.bundle?.patch === void 0 ? void 0 : manifest` — **this single check decides "is a bundle"**. Else it installs as a plain dependency and prints `` dsh: warning: ${name} declares no dsh.bundle — installed as a plain dependency, not a profile layer `` (`operations.js:44-72`). |
| `dsh.client.platform` | with `dsh.client` | Must be the string `"web"`; non-string → `client-modules: ${pkgName} dsh.client.platform must be a string` (`:65`); non-`web` skipped (`:714`). |
| `dsh.client.inject` | optional | A **package-name load-order list**, not module specifiers; only registered packages may be named. |
| `dsh.client.external` | optional, usually omit | Adds *"only exact non-baseline requests, each answered by the dynamic package row it names or an exact static-table key"* (`dsh-client-modules\README.md:46`). |
| `dsh.compatibility` | optional | Marketplace metadata (`dsh-cost-meter` declares `dsh:">=0.1.0-rc.5"` + `dshReleases` with `"0.2.0-rc.2":"compatible"`). **Not consulted by the DSH compatibility check** (§5). |
| `engines` | optional | `dsh-cost-meter` `node >=20`; `dsh-skills-manager` `^22.19.0 \|\| >=24.0.0`. |
| `peerDependencies` | dangerous default-deny | Any peer named `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` is **enforced against the runtime** (§5). `dsh-memory-evolve` declares none and always passes. |
### 2.3 Host half
`dsh-memory-evolve\lib\index.js` opens with *"Pure plugin: only public seams (`systemPrompt`, `tools`, `commands`, `subagents`, `approval`), zero DSH core changes, zero runtime dependencies"*, then plain `import { spawn, spawnSync } from 'node:child_process'`. Cordis consumes **named ESM exports** from `lib/index.js` (Plugin/apply shape). No build step needed for the host half.
### 2.4 Client half — a build step IS required
`@deepseek-ai/dsh-client-modules\README.md:48-50` ("Build requirements"): *"The host serves **built** client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly with one build instruction and a package/path list. Source launch maps host imports to TypeScript source but still consumes the built client export."*
`MissingClientBundleError` (`lib\index.js:128-142`): `` client-modules: client bundle not found; run `pnpm run build` before launch:\n  package: ${packageName}\n  path: ${clientPath} ``
The artifact is **not** raw ESM — it is a lazy-CJS registration (`dsh-memory-evolve\lib\client.js`, 1,185,804 B):
```js
window.__ModuleLoader__.load({ id: "dsh-memory-evolve", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
/* esbuild CJS output; `require(...)` for platform modules */
return module.exports; } });
```
The `id` **must equal the loader entry name** = package `name` = patch row `name`. `scripts/build.mjs` enforces it: `const PLUGIN_ID = MANIFEST.name`, comment *"Loader entry name — must equal the patch row `name` EXACTLY"*. A hardcoded/`@dsh-local/`-prefixed id yields *"loaded without registering"*; the old `@dsh-local/` symlink + `~/.dsh/config.yaml` mechanism is dead (`config.yaml` no longer read).
Canonical build: `dsh-memory-evolve\scripts\build.mjs` (esbuild resolved from the DSH checkout; else `` `esbuild not found under ${checkout} (set DSH_SOURCE to the DSH checkout root)` ``) with `entryPoints:['src/client/index.ts']`, `outfile:'lib/client.js'`, `bundle:true`, `format:'cjs'`, `platform:'browser'`, `target:'es2022'`, `external:EXTERNALS`, `loader:{'.css':'text'}`, `define:{'process.env.NODE_ENV':'"production"','import.meta.env.MODE':'"production"','import.meta.env':'{"MODE":"production"}'}`, plus the banner/footer above. **Gotcha:** esbuild's text loader emits a template literal unless the CSS contains **>2 backticks**, which switches it to a double-quoted one-line string (~2150-line diff). Keep inlined CSS at ≤2 backticks.
### 2.5 Exactly how the client bundle reaches the browser
1. `dsh-client-modules\lib\index.js` subscribes to `internal/plugin`, seeds `for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)`, reconciles each dirty **loader entry name** against live enabled entries (`processOne` `:833-857`, skipping `entry.disabled`). Two active sources for one name → `` client-modules: package ${packageName} resolves from multiple active Loader sources: …; remove one entry `` (`:871-892`).
2. It reads `exports["./client"]` → `clientPath` and serves it over `PLUGIN_ROUTE = "/plugins"` (registered via `ctx.inject(["webServer"], …)` → `webServer.register({ kind:"prefix", path:"/plugins", handler:this.serveBundle })`, `:201`, `:506-979`). Combo URL `??<id>/client.js,…&rev=<rev>`; chunk URL `/plugins/<id>/client.<name>.js?rev=<rev>`; header `public, max-age=31536000, immutable`; combos capped at `MAX_COMBO_URL_BYTES = 3*1024`.
3. `bootInjections(graph)` (`:453-498`) injects into `<head>` an inline `window.__ModuleLoader__` **queue facade** (`mode:"queue"`, `pendingQueue`, `load(reg){pendingQueue.push(reg)}`, `create()`), preloads, blocking `script-src` rows for the bootstrap combo, then a `global` row `name:"__DSH_BOOT__"` carrying the graph. The shell installs the returned system as its Loader `internal` and publishes it as `ctx.modules`.
4. The browser half only **registers a factory**; module bodies (CSS injection included) run at materialization (`factory(require)` → exports, memoized in `loadCache`). Require cycles throw. Resolution: platform seed table → memoized records → boot-graph rows → registered factories; a miss throws `` client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive) `` (`lib\client.js:705`).
5. Revisions are metadata-derived: `artifactRevision = framedHash("plugin-artifact",[mtimeMs, ctimeMs, size])` — **never content-hashed**, so unchanged artifacts keep their revision across restarts.
**The actual platform seed table (authoritative)** — `dsh-web-frontend\dist\assets\index-5SrrfWpU.js`:
```js
function rM(){ return { "react":Ef, "react/jsx-runtime":If, "react-dom":Rf, "react-dom/client":Df,
  "@deepseek-ai/cordis":sf, "@deepseek-ai/dsh-client-store":lh,
  "@deepseek-ai/dsh-client-ui-slots":hh, "@deepseek-ai/dsh-client-ui-primitives":sE,
  "@deepseek-ai/dsh-client-ui-dockkit":XS } }
```
⇒ **exactly 9 seed words.** Absent: `@deepseek-ai/dsh-client-runtime` (the package **does not exist** in 0.2.0-rc.2), `@deepseek-ai/dsh-client-web-react`, `@deepseek-ai/dsh-client-schema-form`. `dsh-memory-evolve`'s `EXTERNALS` still cites those three — harmless (an unused external never appears in `require`) but **do not copy that list**. Use the 9 words above; anything else you `require()` must be supplied by `dsh.client.external` naming another dynamic package row or the require throws at runtime.
## 3. Installation into the live profile (minimal, reversible)
### 3.1 How a `link:` dep actually lands
`C:\Users\ming\.dsh\profiles\desktop\node_modules\dsh-memory-evolve` is a **Windows Junction** → `C:\Users\ming\.dsh\local-plugins\dsh-memory-evolve`. The lockfile needs only the importer entry, no package snapshot — `pnpm-lock.yaml:20-22`:
```yaml
      dsh-memory-evolve:
        specifier: link:C:/Users/ming/.dsh/local-plugins/dsh-memory-evolve
        version: link:../../local-plugins/dsh-memory-evolve
```
⇒ `link:` is a **projection, not a download**. Boot also cleans legacy link state: `removeLinkProjections(dir)` (`dsh-app-boot\lib\index.js:602-611`, called from `loadProfile` `:977`) unlinks only symlinks under `<profile>\node_modules` pointing into `<profile>\.dsh-module-fallback\node_modules`, then deletes that dir (`LINK_PROJECTION_DIR = ".dsh-module-fallback"`, `:594`). Pnpm-installed packages and every other symlink/junction are left alone — our dep is safe.
### 3.2 Preferred path: `dsh plugin`
`@deepseek-ai/dsh\lib\plugin-BGnVfe_D.js` routes `plugin` to `runProfilePnpm`; the desktop profile is **owned by the app**: `requireDesktopProfile` throws *"Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop."*, and `rejectElectronProfile` blocks `dsh --profile desktop` (*"profile \"desktop\" is managed exclusively by the Electron application"*). Options: `{ execution:"cli", outputBytes:16384, lockWaitMs:120000, lookupTimeoutMs:120000 }`, wrapped in `withFileLock(join(dir,"package.json"), …, { waitMs:120000 })`. DSH-owned subcommands intercepted before pnpm: `version-exemptions`, `allow-version <package@version> --dsh-version <exact> --accept-risk`, `revoke-version <package@version> --dsh-version <exact>`. On failure: `` dsh: plugin command failed; diagnostics: ${result.logPath} `` and, for incompatible peers, `` dsh: to accept the risk, run: dsh plugin --profile ${profile} allow-version ${name}@${version} --dsh-version ${runtimeVersion} --accept-risk ``.
### 3.3 Manual fallback (fully reversible)
Bundled runtimes (no PATH dependency): `D:\AI_Programs\Deepseek-harness\resources\runtime\primary-runtime\dependencies\` → node `...\node\bin\node.exe`, pnpm `...\pnpm\bin\pnpm.cjs` (siblings `pnpm.mjs`, `pnpx.cjs`, `pnpx.mjs`).
```powershell
$PROFILE = 'C:\Users\ming\.dsh\profiles\desktop'
$NODE    = 'D:\AI_Programs\Deepseek-harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$PNPM    = 'D:\AI_Programs\Deepseek-harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
Copy-Item "$PROFILE\package.json"     "$PROFILE\package.json.bak-$(Get-Date -Format o | ForEach-Object { $_ -replace '[^0-9]','' })"
Copy-Item "$PROFILE\pnpm-lock.yaml"   "$PROFILE\pnpm-lock.yaml.bak"
Push-Location $PROFILE
& $NODE $PNPM add "link:D:/AI_Work/开发/删除会话插件"
& $NODE $PNPM install
# then append "dsh-session-delete" to dsh.profile.bundles IN package.json (pnpm never edits that key)
Pop-Location
```
- **`pnpm install` is still needed once** even though nothing is downloaded: `link:` creates the `node_modules` junction and the lockfile importer record. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, `autoInstallPeers: false`, `packages: [.]`; `minimumReleaseAgeExclude` only affects registry versions, so a `link:` dep is unaffected.
- **Order in `dsh.profile.bundles` is load order.** Appending makes our bundle the outermost layer (its inserts land last); the profile patch and `~/.dsh/cordis.patch.yml` still apply after it (§1.4).
- The profile already carries a `.bak-<epoch-ms>` written by the app's own writer — that naming is safe to copy.
- **Rollback**: restore both backups, `& $NODE $PNPM install --frozen-lockfile`, then `Remove-Item "$PROFILE\node_modules\dsh-session-delete" -Force`. Pnpm 11 build-script blocks surface as `pendingBuilds` and are fixed with an `allowBuilds` entry in `pnpm-workspace.yaml` (the app's Web UI offers "Allow these scripts and retry"); a pure-JS plugin that only runs `node scripts/build.mjs` before install has none.
### 3.4 Profile patch vs bundle patch
| | bundle patch (`<plugin>/cordis.patch.yml`) | profile patch (`<profile>/cordis.patch.yml`) |
|---|---|---|
| Applied | one layer per bundle, in `bundles` order | last, before `~/.dsh/cordis.patch.yml` and `--patch` |
| Typical content | a single `insert` row naming itself | id-targeted overrides (`config`, `disabled`) |
| Missing file | n/a (a declared path that cannot be read skips the bundle with a stderr line) | allowed: ENOENT ⇒ no layer |
| Empty/comments-only | fails (must parse to an array) | fails too — *"disable the layer with `[]` instead"* (`README.md:61`) |
| Edited by the app | never | yes — `writePluginEnabled`; header says *"Your patch layer for this dsh profile, applied after every bundle layer"* |
⚠️ **Never re-insert a bundle's row in the profile patch.** `dsh-memory-evolve`'s patch header states it: the bundle patch is applied automatically, so a duplicate insert means **duplicate ids, which crash the loader**.
## 4. Hot reload / restart
### 4.1 What `root: []` means
`@deepseek-ai\dsh-hmr\lib\index.js:237-247`:
```js
static Config = z.object({ base: z.string(),
  root: z.array(String).role("table").default(["."]),
  ignored: z.array(String).role("table").default(["**/node_modules","**/.*","cache","data"]),
  debounce: z.natural().role("ms").default(100) })
```
`root` = directories watched for **module** changes. With `root: []` the picomatch watcher matches nothing (`:439-440`: `let readyState = root.length === 0 ? "resolved" : "pending"; if (root.length === 0) ready.resolve();`) — the service still initializes and needs no `ready` event. Live config (`cordis.yml:9-13`):
```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: !!js '!ctx.get(''profileContext'')'
  config:
    root: []
```
So the profile is `applied`-capable: `dsh-plugin-manager\lib\index.js:2042` sets `application: this.ownerContext.get("hmr") !== void 0 ? "applied" : "restart-required"`.
### 4.2 Profile HMR watches the manifest and patch files REGARDLESS of `root`
`@deepseek-ai\dsh-hmr\lib\index.js:339-377` (profile branch; requires `this.ownerContext.get("appReady")` else throws `"Profile HMR requires application readiness"`):
```js
const manifestPath = join(profile.dir, "package.json");
const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)];
const refresh = async (manifestOnly) => {
  const bundles = JSON.stringify(readProfileManifest("dsh", profile.dir).dsh?.profile?.bundles ?? []);
  if (manifestOnly && bundles === lastBundles) return;
  const inputs = JSON.stringify([bundles, ...patchFiles.map(...readFileSync...)]);  // ENOENT -> null
  if (inputs === lastInputs) return;
  const patches = readProfilePatches("dsh", profile);
  const warnings = await reconcileProfilePatches(this.ownerContext.root, patches, "dsh");
  lastInputs = inputs; lastBundles = bundles;
  for (const diagnostic of warnings) this.ctx.logger.warn(diagnostic);
};
for (const filename of patchFiles) await this.watchConfig(filename, () => refresh(false));
await this.watchConfig(manifestPath, () => refresh(true));
```
`reconcileProfilePatches` (`dsh-app-boot\lib\index.js:3468-3496`) requires the root Include entry (`throw new Error(`${binName}: profile reload requires the root Include entry`)`), snapshots prior fibers/failures, re-prepares the patches, `await entry.update({ config: { ...includeConfig, patches: prepared } })`, `await ctx.loader.await()`, throws `activationDiagnostic(binName, introduced)` on **new** activation failures, and emits `app-boot/config-reload`. `watchConfig` (`:298-312`) records `resolve(filename)` and `canonicalPath(filename)` in `this.configPaths` and throws `` `config path already registered: ${filename}` `` on duplicates.
**Consequence:** adding `"dsh-session-delete"` to `dsh.profile.bundles`, or editing `<profile>\cordis.patch.yml`, triggers a live re-compose **without restart** (the `hmr` row is enabled — the profile context exists — and `appReady` has fired). The `node_modules` junction and the plugin's own files are **not** watched (`root`'s job), so:
- **new plugin appearing in `bundles`** → the manifest patch is applied live, the Loader instantiates the entry, `client-modules` picks it up via `internal/plugin`; **a page refresh is still required** to fetch the new browser bundle.
- **editing host code** → no watch ⇒ restart (or run the dev chain `pnpm run dev:web` from the DSH source checkout).
- **editing built `lib/client.js`** → `dsh-client-hmr` (`pollIntervalMs` default `500`) stat-polls the stamped entry artifact and pushes `rebuilt` over `/plugins/events`, so open pages hot-swap it with no refresh; it cannot reinstall the bootstrap (*"The page retains its modules bootstrap and static platform identities. Removing or replacing the bootstrap requires a page reload"*, `README.md:130`).
- **replacing the package's JS generation** → *"Package replacements require restarting the process to load a fresh JavaScript module generation"* (`dsh-plugin-manager\README.md:130`).
Bottom line: **first install ⇒ full DSH restart is the safe, supported route** (`dsh plugin`, quit app, relaunch). Live recompose is a convenience for enable/disable and for adding an already-present bundle.
### 4.3 Where to read load errors
- **Plugin-manager operations (pnpm/git).** `<profile>\.plugin-manager\logs\operation-<6 chars>\pnpm.log` and `...\github-connection-<6 chars>\git.log` — from `dsh-plugin-manager\lib\index.js:428-446` (`logRoot = join(dir,".plugin-manager","logs"); logPath = join(await mkdtemp(join(logRoot,"operation-")), "pnpm.log")`); `:973` mirrors it for git. Failure prints `` dsh: plugin command failed; diagnostics: ${logPath} ``. **Live observation:** that dir holds *only* those per-operation dirs (33 `operation-*`, 4 `github-connection-*`, 0–1473 B) — **no aggregate loader log**.
- **Bundle/patch load errors** go to the dsh process **stdout/stderr**: skipped bundles via `reportSkippedBundles` (`` `dsh: skipping profile bundle …: <reason>` ``), compatibility denials via `` `${binName}: disabling profile plugin ${label}: ${reason}` ``, patch warnings via the `warn` sink. Launch from a terminal to capture them.
- **Composed tree**: `dsh --profile <name> --dump-config` (`--dump-default-config` omits the user layer, `--dump-config-schema` prints JSON Schema). ⚠️ Not usable on `desktop` (`rejectElectronProfile`); copy the profile or use a scratch one.
- **`~/.dsh\cache`, `~/.dsh\storages`**: present, but grep found **no plugin-loader use** — treat as unrelated. **UNVERIFIED.**
- **`.plugin-manager\run.json`** (`runRecordPath = join(dir,'.plugin-manager','run.json')`, `operations.js:156-164`) is the single-operation guard; read it to see whether a prior pnpm run still holds the profile. (No such file was observed live — **UNVERIFIED** for this profile.)
### 4.4 Live profile state (facts)
`cordis.patch.yml` (827 B) = header + **4 id-targeted overrides, zero inserts**: `ui-settings-account` (`{version:1, step:done, purpose:null, process:standard, completion:skipped, usage:compact, developerTools:false}`), `ui-chat` (`{transcriptView:standard, performanceUsage:compact}`), `ui-settings` (`{enabled:false}`), `agent-default-model` (`{provider:deepseek-account, model:deepseek-flash, reasoningEffort:high}`).
`package.json` (644 B) deps: `@wisdoverse/dsh-skills-manager 1.0.6`, `billion-context 0.1.188`, `dsh-cost-meter 1.8.15`, `dsh-memory-evolve: link:C:/Users/ming/.dsh/local-plugins/dsh-memory-evolve`, `dshmarket ^1.66.11`; `dsh.profile.bundles` = `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dshmarket","dsh-cost-meter","billion-context","dsh-memory-evolve","@wisdoverse/dsh-skills-manager","@deepseek-ai/dsh-experimental-agent-team-profile"]`.
The memory-evolve patch row is id `dsh-memory-evolve` / name `dsh-memory-evolve` and is *not* duplicated in the profile patch — the pattern to copy.
## 5. Version / compatibility rules (DSH desktop `0.2.0-rc.2`)
`dsh-app-boot\lib\index.js:286-313` `evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion())`: returns `undefined` unless the manifest declares `peerDependencies`; **only** names equal to `@deepseek-ai/dsh` or starting with `@deepseek-ai/dsh-` count; `workspace:^|~|*` is treated as `runtimeVersion`; incompatible when `requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`; returns `{ name, version, runtimeVersion, peers, exempted }`.
`getDshRuntimeVersion()` (`:271-275`) reads the `package.json` **of the `dsh-app-boot` package** ⇒ runtime version = `@deepseek-ai/dsh-app-boot`'s version = **`0.2.0-rc.2`** (matches `.ref\dsh\package.json` `@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2, whose ~300 `@deepseek-ai/*` deps are all pinned 0.2.0-rc.2). `dsh.compatibility.dsh` / `dshReleases` are **not** part of this check. `identityField` requires a non-empty string name/version only once peers are incompatible.
Incompatible ⇒ throw (`:320-323`, `key = ${issue.name}@${issue.version}`):
> `Plugin ${key} is incompatible with dsh ${issue.runtimeVersion}: peerDependencies ${JSON.stringify(issue.peers)}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: ${issue.exempted ? "active" : "not active"}.`
- Bundle path: `loadProfileDirectory` evaluates each bundle; incompatible + not exempted throws ⇒ the bundle is **skipped** into `skippedBundles` (`:920-954`).
- Entry path: `prepareProfileEntries`/`preflight` (`:2057-2140`) instead `deny()`s by setting `row.disabled = true` (and `row.group = false`), reporting `` `${binName}: disabling profile plugin ${label}: ${reason}` ``, recursing into group children and `cordis:include` / `@deepseek-ai/cordis-plugin-include` files; `prepareProfilePatches` (`:2150-2154`) returns `rows.length === 0 ? [] : [{ insert: rows }]`.
- Exemptions live in `<profile>\compatibility.json` (`PROFILE_COMPATIBILITY_FILENAME`, `:328`), managed by `setProfileVersionExemption(dir, packageVersion, runtimeVersion, enabled, acceptRisk)` (`:421-439`; refuses without `acceptRisk`, requires exact SemVer both sides, writes atomically `mode 0o384`); read via `readProfileCompatibility(dir)`. **No `compatibility.json` exists in the live profile** (verified) ⇒ nothing is exempted.
**Practical rule:** declare **no `@deepseek-ai/dsh-*` peerDependencies at all** (the `dsh-memory-evolve` strategy) and the check is a no-op for any runtime version. If you must import DSH host packages, either declare no peers (nothing is checked) or use the broad union style ending in `|| 0.2.0-rc.2`, e.g. `@wisdoverse\dsh-skills-manager`: `"@deepseek-ai/dsh-home-paths": " >=0.1.1-rc.2 <0.1.2 || >=0.1.2-alpha.3 <0.2.0-0 || >=0.1.3-alpha.1 <0.2.0-0 || 0.2.0-rc.2"`. Also set `"engines": { "node": ">=20" }` for hygiene (bundled runtime is Node 22+; **UNVERIFIED** exact version).
## RECOMMENDED PROJECT LAYOUT + INSTALL CHECKLIST
```
D:\AI_Work\开发\删除会话插件\
  package.json          name "dsh-session-delete"; type module; main lib/index.js;
                        exports { ".":"./lib/index.js", "./client":"./lib/client.js", "./package.json":"./package.json" };
                        dsh { client:{ inject:[], platform:"web" }, bundle:{ patch:"./cordis.patch.yml" } };
                        scripts { build:"node scripts/build.mjs", test:"node --test 'tests/*.test.js'" }
  cordis.patch.yml      - insert: / - id: dsh-session-delete / name: 'dsh-session-delete'
  lib/index.js          host half (ESM named exports; tools / commands / webServer routes)
  lib/client.js         BUILT lazy-CJS: window.__ModuleLoader__.load({ id:"dsh-session-delete", factory:(require)=>{…} })
  src/client/index.ts   client source
  scripts/build.mjs     esbuild -> lib/client.js; PLUGIN_ID = package.json name; external = the 9 real seed words
  tests/*.test.js       node --test
```
1. `package.json` `name` == patch row `name` == `__ModuleLoader__.load({id})` == `PLUGIN_ID` in `scripts/build.mjs`. **All four identical.**
2. `dsh.client.platform: "web"` and `exports["./client"]` present; run `pnpm run build` so `lib/client.js` exists **before** launch.
3. `dsh.bundle.patch: "./cordis.patch.yml"`; the file is a top-level YAML **array** with exactly one `insert` row.
4. No `@deepseek-ai/dsh-*` peerDependencies (or a union ending in `0.2.0-rc.2`) — otherwise expect a skip/disable plus a `compatibility.json` exemption.
5. `dsh plugin --profile desktop add link:D:/AI_Work/开发/删除会话插件` with the app **fully quit** (or the manual `link:` + `pnpm install` of §3.3).
6. Append `"dsh-session-delete"` to `dsh.profile.bundles` (last); edit `cordis.patch.yml` **only** for overrides — never re-insert the bundle row.
7. **Fully restart DSH desktop** for the first load; refresh the page so the browser bundle is fetched.
8. Verify: no `dsh: skipping profile bundle …` on stderr; no `client-modules:` error in the browser console; `node_modules\dsh-session-delete` is a junction to the project dir.
9. Roll back by restoring the `package.json` / `pnpm-lock.yaml` backups, `pnpm install --frozen-lockfile`, and deleting the junction.
### UNVERIFIED / gaps
- Whether the desktop *host* process logs loader errors anywhere other than stdout/stderr (no aggregate log file found).
- Exact Node/pnpm versions of the bundled runtime (paths confirmed, versions not read).
- Whether `~/.dsh\cache` / `~/.dsh\storages` participate in plugin loading (no grep hits).
- `dsh-client-hmr` hot-swap behaviour read from its README, not exercised live.
