# R1 · 会话行 “…” 菜单注入 + 确认弹窗（客户端 UI 插件 API）

目标版本：**DSH 0.2.0-rc.2**（`…\.ref\dsh\desktop-runtime.json` → `release.version = "0.2.0-rc.2"`，`hostProtocolVersion: 4`，`nodeVersion 24.18.1`）。
证据来源：`…\删除会话插件\.ref\dsh\node_modules\@deepseek-ai\`（已解包源码，权威）；可运行第三方插件 `C:\Users\ming\.dsh\local-plugins\dsh-memory-evolve\`、`C:\Users\ming\.dsh\profiles\desktop\node_modules\dsh-cost-meter\`。
未验证项统一在文末 “UNVERIFIED” 列表标注。

---

## 1. 客户端插件入口契约

- **包清单**（`dsh-client-modules\README.md:34`）：“A browser plugin package declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and lists any non-baseline module requests under `dsh.client.external`.”校验在 `dsh-client-modules\lib\client.js:65-72`：`if (typeof decl.platform !== "string") throw new Error(\`client-modules: ${pkgName} dsh.client.platform must be a string\`)`，随后 `optionalStringArray(pkgName, "dsh.client.inject", decl.inject)` / `... "dsh.client.external" ...`。
- **`dsh.client.inject` 语义 = 只是启动图排序提示**：`dsh-client-modules\lib\client.js:640-657` `arriveGraphRow(row)` 里 `for (const packageName of row.inject) { const dependency = this.graphRows.get(packageName); if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited); }` —— **不存在的名字被静默跳过**。所以 `inject: ["@deepseek-ai/dsh-client-runtime"]` 无害但也没用。
- **`@deepseek-ai/dsh-client-runtime` 不存在**：`…\@deepseek-ai\` 下 287 个包中无此目录，不在平台种子表，全 `.ref` 递归搜索只命中 `dsh-invariants\README.md:69` 的散文（“…`dsh-client-modules`, `dsh-client-runtime` | Browser/node-half stat-watcher lifecycle…”）。**不要 `require()` 它**（会抛 `client-modules: require("…") missed the module table …`，`dsh-client-modules\lib\client.js:702`）。
- **包体格式**（`dsh-client-ui-workspace\lib\client.js:1-4`）：`window.__ModuleLoader__.load({ id: "<package.json name>", factory: (require) => { var module = { exports: {} }; var exports = module.exports; … return module.exports } })`。裸 `require` 解析顺序（`dsh-client-modules\lib\client.js` 文档 + README:68）：**平台种子表 → 已物化记录 → 启动图行 → 已注册 factory**；其他一律抛错。
- **平台种子表（唯一可直接 `require` 的基线）**，实测自发行壳包 `dsh-web-frontend\dist\assets\index-5SrrfWpU.js` 的 `function rM()`：
  `{react, "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-dockkit"}`。
  注意：**`@deepseek-ai/cordis`（不是 `cordis`）**；`dsh-client-locale`、`dsh-client-ui-workspace`、`dsh-api-session-controller` **不**在种子里，它们走启动图动态包。
- **模块导出**：`exports.apply = apply; exports.inject = inject;`（`dsh-client-ui-workspace\lib\client.js:4419-4420`）。真实第三方写法 `dsh-memory-evolve\lib\client.js:17881`：`var inject = ["slots", "locale", "conversation", "sessions"];`。
- 本插件需要的三个包（`react`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`）**全部在种子表内**，无需 `dsh.client.external`。

## 2. Slot 系统 API

- 纯注册表：`dsh-client-ui-slots\lib\index.js`（577 行，无 React）。导出（:575）：`SlotCore, SlotOwnershipError, StaleAuthorizationError, resolveSlotLabel, standardHookPropName`。
- **声明槽位（只有父条目才能声明子槽）**：`SlotCore.register(options, component)`（:163）。未声明即注册 → `slot "${options.name}" is not declared (a parent entry's children table must declare it)`（:165）。`children` 表项形如 `{ kind: "list"|"single"|"keyed"|"chain", scope: "root"|"session"|"session-maybe", inject?: { hooks, keyedHooks } }`。
- **`list` 类型必须给 `id`**：`:169-190` → `list slot "${options.name}" requires options.id`；同 id 冲突 → `list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`。`occupantHint` 提示 “register at a different priority to shadow it (lowest renders)”。
- **排序**（:221）：`next.sort(spec.kind === "list" ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0) : …)` —— 先 `priority` 后 `order`，升序。
- 识别字段：`{ name, id?, key?, order?, label?, priority?, select?, inject?, children?, store?, locale?, registrant? }`；规范化后 `entry.options` 只留 `{key, id, order, label, priority}`（:204-219），`inject/children/store/locale` 挂在 entry 上。
- **消费槽位**：`ctx.slots.inject(key, callback)`（`dsh-client-ui-renderer\lib\client.js:1343`，`@param key - declared SlotMap key`，`@param callback - creates one disposer or an iterable of disposers`，返回幂等 disposer）。槽位声明出现前等待、消失后自动卸载 —— 因此第三方插件**必须**用 `inject` 而不是直接 `register`。
- **组件收到的 props（关键）**：`standardKit()`（`dsh-client-ui-renderer\lib\client.js:715-746`）+ `renderEntry`/`ContextualEntry`（:752-789）合并顺序为
  `...kit(标准 hook + renderFactorySlot/renderSlot + t + useStore/actions) , ...inject 业务面 , ...slotInject.props , ...contextual(slot 级 hook 工厂) , ...ownerProps`（owner 最后，覆盖前面）。
  即：`t` 来自 `if (entry.locale !== void 0) kit["t"] = localeSeat(face, entry.locale)`（:721-725）；`renderSlot` 仅在条目声明了 `children` 时才注入（:732-733）；业务面用 `inject`（`bindInjectSources`，:423-438，`hooks` 里的键自动变成 `useXxx`）。
- 标准 hook 的注入点：`ctx.slots.provideRoot({ hooks, keyedHooks })`（`dsh-client-ui-renderer\lib\client.js:1440`）。`sessions` 由 `dsh-client-ui-chat\lib\client.js:469-474` 提供（`{ sessions: ctx.sessions.list, keyedHooks: { sessionRetainInfo: (key) => ctx.sessions.retainInfo(key) } }`），`workspaces` 由 `dsh-client-ui-workspace\lib\client.js:4142` 提供。
- 错误隔离：单个条目崩溃只渲染 `<div data-slot-error="…">` 并打印 `slot entry crashed in '${this.props.slotKey}':`（:611-625）；装配错误 `SlotAssemblyError` 直接抛出（“fail loud”），例如条目声明了 `locale` 但没有任何 locale 插件 → `entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`（:723）。

## 3. 会话行 “…” 菜单槽：`sidebar.workspaces.session.menu.item`

机读目录（权威文档）在 `dsh-cordis-client-runner\lib\client.js:5835-5884`：

- `kind: "list"`，`scope: "root"`，summary “The rows of one Session's "…" menu, in ascending `order`.”
- 官方条目说明：出厂行 `pin`(100) / `rename`(200) / `fork`(300) / `archive`(400)；**用带包名前缀的 `id`**；同 id 换 `priority` 可遮蔽出厂行。每个条目渲染**一个 `role="menuitem"` 的 `<button>`**（出厂行用 ui-primitives 的 `MenuItemButton`，自带宿主样式与 `separatorBefore`）；自己决定可见性；动作后用注入的 `useMenuOpenState` 关菜单；列表的键盘遍历与焦点回收**读 DOM**，所以任何这样的 button 都会自动并入。
- `registerOptions`：`id`（必填 string，cell key）、`order`（可选 number，升序，默认 0）、`label`（可选 `string | (() => string)`，每次投影重读，用于本地化）。
- `ownerProps`：`interface SessionRowOwnerProps { sessionId: SessionId; displayTitle: string }`。
- `standardProps`：`useResource`、`useWorkspaces`、`usePanelInfo`、`useSessions`、`useSessionStatus`、`useSessionRetainInfo`。
- `hookContext: "MenuOpenState"`；`slotInject`：`{ hooks: { menuOpenState: SlotHookFactory<…, UseMenuOpenState>, shortcuts: HostObservable<readonly ShortcutCatalogEntry[]> } }`。
- 目录里的官方最小例子（:5883，逐字）：注册 `{ name, id: 'copy-session-id', order: 500 }`，组件签名 `({ sessionId, useMenuOpenState }) => { const [, setMenuOpen] = useMenuOpenState(); … }`。
- **出厂注册代码**（`dsh-client-ui-workspace\lib\client.js`，均在 `apply(ctx)` 内）：
  - 声明（:4297-4330）：`ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({ name: "sidebar.workspaces", children: { … "sidebar.workspaces.session.menu.item": { kind: "list", scope: "root", inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: ctx.shortcuts.catalog } } }, … }, store: viewStore, inject: browserInjected, locale: NS }, WorkspaceBrowser))`
  - 注入菜单行（:4331-4360）：`ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () { yield ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "pin", order: 100, locale: NS, inject: pinInjected }, PinSessionMenuItem); … id: "rename", order: 200 …; id: "fork", order: 300 …; id: "archive", order: 400 … })`
  - `menuOpenStateFactory = (_standard, state) => () => state`（:21）把行的 `hookContext` 绑成条目的 `useMenuOpenState()`，返回 `[open, setOpen]`。
  - 菜单拥有者（`SessionNodeItem`，:1579-1580 + :1645-1668）：`const [menuOpen, setMenuOpen] = react.useState(false); const menuOpenState = react.useMemo(() => [menuOpen, setMenuOpen], [menuOpen]);` … `renderSlot("sidebar.workspaces.session.menu.item", { sessionId: node.id, displayTitle: row.title }, { hookContext: menuOpenState })`。
- 出厂 archive 行（`ArchiveSessionMenuItem`，:3424-3437）示范了“关菜单 + 触发动作 + 可选快捷键”：`const [, setMenuOpen] = useMenuOpenState(); const shortcut = useShortcuts(rows => rows.find(row => row.id === "session.archive")); const archived = useArchived(set => set.has(sessionId));` → `MenuItemButton{ shortcut: archived ? void 0 : shortcut, icon: …, onSelect: () => { setMenuOpen(false); (archived ? unarchiveSession : archiveSession)(sessionId) }, children: t(…) }`。
- **弹窗槽位 `shell.overlay`**（`dsh-cordis-client-runner\lib\client.js:4816-4898`）：`kind: "list"`，root scope，叠加式，“click-through until your entry opts into pointer events”；由 `dsh-client-ui-layout\lib\client.js:312` `react.useMemo(() => renderSlot("shell.overlay", {}), [renderSlot])` 渲染（**ownerProps 为空 `{}`**）。出厂确认弹窗就注册在这里（`dsh-client-ui-workspace\lib\client.js:4377-4397`）：
  `ctx.slots.inject("shell.overlay", function* () { yield ctx.slots.register({ name: "shell.overlay", id: "workspace.session-archive", locale: NS, inject: archiveConfirmInjected }, SessionArchiveConfirmDialog); … })`
- **跨条目共享弹窗状态**：出厂用 `archiveRequest = createSnapshotStore(null)`（`@deepseek-ai/dsh-client-store`）作为注入 hook 源，菜单行 `set`，弹窗 `useArchiveRequest(pending => pending)` 订阅；`SessionArchiveConfirmDialog`（:3469-3478）`const request = useArchiveRequest(pending => pending); if (request === null) return null; return <ArchiveConfirmForm … key={request.sessionId} />`（**state 放在按 sessionId keyed 的子组件里**，避免 hooks 顺序问题）。同一个 root-scope store handle 可被多个条目共用（`resolveStore`，`dsh-client-ui-renderer\lib\client.js:1688-1704`，`record.scope === "root"` → 单一实例 `ROOT_INSTANCE_KEY`）。
- `createSnapshotStore(init, opts)` 返回 `{ getSnapshot, subscribe, update(draftMutator), set(next) }`（`dsh-client-store\lib\index.js:70-101`）；`subscribe` 回调**不接收参数**（:74-76），所以只能配合 `getSnapshot()` 用；作为 hook 源直接可用（`observableHook(source)` → `bindSnapshotSelector(source)`，`dsh-client-ui-renderer\lib\client.js:219-226`）。

## 4. UI 原语（行 + 弹窗）

导出总表在 `dsh-client-ui-primitives\lib\index.js:12381`。相关：

- **`MenuItemButton`**（:3830，doc :3822-3829）：`function MenuItemButton({ children, shortcut, icon, disabled = false, danger = false, separatorBefore = false, onSelect })` → `div.itemWrap > [separatorBefore && div.separator(role="separator"), button{type:"button", role:"menuitem", className: clsx(css.item, danger && css.danger), disabled, "aria-keyshortcuts": shortcut?.aria, onClick: onSelect}]`（:3831-3861）。
- **危险红行**：`danger: true` 即变成红色文字/图标 + 红色 hover 底色。`dsh-client-ui-primitives\lib\Menu.module.css`：`.danger{color:var(--dsw-alias-state-error-primary)} .danger .itemIcon{color:var(--dsw-alias-state-error-primary)} .danger:hover:not(:disabled), .danger:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}`。
- **图标**：`IconTrashOutlineRegular` / `IconTrashOutlineMedium`（:1176 / :1181，`size` 默认 16）、`IconWarningOutlineRegular`、`IconWarningTriangleOutlineRegular`。**没有 `Delete` 命名的图标，也没有 `IconTrashFill*`**（grep 已确认）。
- **`Button`**（:3216）：`forwardRef(function Button({ variant = "ghost", size = "md", icon, className, children, ...rest }, ref))` → 直接 `...rest` 透传到 `<button>`（**可传 `style`、`disabled`、`onClick`**）。合法 variant **只有** `primary | ghost | outline | toolbar`，size 只有 `md(36px) | sm(28px)`。**没有 `danger` variant**。
- **红色确认按钮的正确做法**（出厂 archive 弹窗）：`Button variant="outline"` + 一个 `color: var(--dsw-alias-state-error-primary)` 的 class。出厂用的 workspace CSS-module 类 `deleteAction` 定义在打包 CSS 串 `dsh-client-ui-workspace\lib\client.js:2036`（`._9lTDKa_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}`），**第三方无法 import 该 module map，必须自己写等价规则**（见骨架用内联 style）。
- **`Modal`**（:5210，doc :5190-5208）：`function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, onKeyDownCapture, headless = false, backdropBlur = true, shortcutModal })`。`!open` 时返回 `null`；`createPortal` 到 `document.body`；`useModalLayer(dialog, open, onClose)`；渲染 mask（`onClick: onClose`）、`role="dialog" aria-modal="true" aria-label={title}`、`<h2>{title}</h2>` + 关闭按钮、可选 `<p>` 描述、body、可选 footer。**初始焦点控件请标 `data-modal-autofocus`**（不要用 React `autoFocus`，否则焦点归还失效）。`closeLabel` 是关闭按钮的无障碍标签（需本地化）。
- **`RiskConfirmation`**（:5273）：`({ open, title, description, acknowledgeLabel, cancelLabel, closeLabel, confirmLabel, acknowledged, disabled = false, onAcknowledgedChange, onCancel, onConfirm })` —— 现成的“必须勾选确认”弹窗（内容为 `IconWarningOutlineRegular size={18}` + 描述 + `data-modal-autofocus` 复选框），但确认按钮是 `variant="primary"`，**不是红色**。
- 出厂 archive 弹窗逐字结构（`ArchiveConfirmForm`，`dsh-client-ui-workspace\lib\client.js:3478-3532`）：`const [archiving, setArchiving] = react.useState(false); const [error, setError] = react.useState(null); const close = () => { if (archiving) return; onSettle(); }; const confirm = () => { setArchiving(true); setError(null); stopAndArchiveSession(request.sessionId).then(() => { setArchiving(false); onSettle(); }).catch(reason => { setArchiving(false); setError(reason instanceof Error ? reason.message : String(reason)); }); };` + `Modal{ open: true, onClose: close, closeLabel: t("close"), title: t("archive.confirm.title"), description: t("archive.confirm.desc", {title: request.displayTitle}), footer: <><Button variant="outline" …>{t("cancel")}</Button><Button variant="outline" className={…deleteAction} …>{t("archive.confirm.action")}</Button></>, children: [<ul>…</ul>, archiving && <div role="status">…, error !== null && <div role="alert">{error}</div>] }`。

## 5. Locale / i18n

- 服务（`dsh-cordis-client-runner\lib\client.js:1169-1262` 目录）：`register(ns, locale, dict)`、`bind(ns)`、`getSnapshot()`、`subscribe(fn)`、`setLocale(id)`。
- `dsh-client-locale\README.md:36-66`：“Call `ctx.locale.register(ns, { zh, en })` with a namespace merged into `LocaleNamespaceMap` … Consumers translate through `ctx.locale.bind(ns)` or the framework-injected `t` seat. **A dictionary registered after the UI is already mounted is picked up without a remount.**”
- 未类型化（第三方无需改 DSH 源码）的调用形式：`ctx.locale.register('common', 'ja', { cancel: 'キャンセル' })`；`t` 的签名实测为 `const t = (key, params) => bound(key, params)`（`dsh-client-ui-renderer\lib\client.js:522-538`，按 locale revision 记忆化，切语言时换新引用以驱动 `React.memo`）。
- **注册条目时给 `locale: NS`，组件即收到 `t` prop**（同上 :721-725）。真实第三方写法（`dsh-memory-evolve\lib\client.js:17883-17884`）：`const t2 = ctx.locale.bind(NS);`（顶层）+ `ctx.effect(() => ctx.locale.register(NS, { zh, en }), "memory-evolve: dictionaries");` + `inject = ["slots", "locale", …]`。
- 另一种被验证可行的第三方做法（`dsh-cost-meter`）：**完全不接 locale 服务**，自己在包内塞 `zh/en` 字典表并自建 `t`（`dsh-cost-meter\lib\client.js` 的 require 只有 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`）。适合只想跑起来的插件。
- 规则（`dsh-client-locale\README.md:84`）：“Product-authored Client UI text must enter through these typed dictionaries or an already-localized primitive prop; `verify-client-ui-i18n` enforces that source ownership.”（该 lint 针对 DSH 自身源码，第三方不受强制。）

## 6. 变更后的刷新 & 「删除会话」到底有没有现成 API

- **sessions 服务**：`dsh-api-session-controller\lib\client.js:3190` `rootCtx.reflect.provide("sessions", this, void 0);`；列表快照字段 :3164-3169 `createSnapshotStore({ ids: [], byId: {}, phase: "pending", projectionsBySession: {} })` → **`{ ids, byId, phase, projectionsBySession }`**。
- **刷新**：`refresh()` 逐字（:3255-3259）`/** Refresh the real Session baseline, reusing an in-flight pull. */ refresh() { return this.manager.refreshList(); }`；另有 `refreshProjections(sessionId)`（:3251）。第三方拿法二选一：`inject: ["sessions"]` → `await ctx.sessions.refresh()`（`dsh-memory-evolve` 的 inject 列表已验证含 `"sessions"`），或组件里 `const list = useSessions(s => s)` 读 `list.ids / list.byId`。
- **⚠ 0.2.0-rc.2 没有任何「删除会话」RPC**。`dsh-api-workspace-controller\lib\typert.host.js` 的远程签名全集为：`pick / list / createDirectory / create / initializeDefault / rename / delete / insertBefore / insertSessionBefore / archiveSession / unarchiveSession / pinSession / unpinSession / follow` —— `delete` 是**工作区**删除，会话只有 `archiveSession`/`unarchiveSession`。`dsh-api-session-controller\lib\typert.host.js` 也没有 delete/remove。`dsh-session-persistence-jsonl` 只清理自己的 writer/handle map（:322/:352/:375-376），不存在 `removeSession`。
  → **本插件必须自带 host 半边**（自己删磁盘会话文件 + 调 `ctx.sessions.refresh()` 让列表刷新）。
- **会话落盘布局**（`dsh-session-persistence-jsonl\lib\index.js`）：`sessionDir(root, cwd, id) = join(projectDir(root, cwd), encodeSegment(id))`（:914）；`projectDir(root, cwd) = cwd === void 0 ? join(root, "_no-cwd") : join(root, projectKey(cwd))`（:902）；`projectKey(cwd)` = `--` + （`/ \ :` → `-`，其他不安全码位 → `~XXXX`）+ `--`，截断 251 字符（:875-894）；`encodeSegment` 同样的 `~XXXX` 转义并特判 `.`/`..`（:853-865）；日志文件名 `vN.jsonl[.zstd]`（:747-763）。本机实测根目录 `C:\Users\ming\.dsh\sessions\--D-AI_Work-~5F00~53D1-~5220~9664-4F1A~8BDD~63D2~4EF6--\`（与 `projectKey` 完全一致）。另存在 `C:\Users\ming\.dsh\session-manager-trash\`（疑似历史插件遗留回收站，非 DSH 自带）。
- **host 半边对外暴露 HTTP**（真实第三方 `dsh-memory-evolve\lib\api.js:846`）：`return ctx.webServer.register({ kind: 'prefix', path: '/memory-evolve', handler })`；`handler = async (req, res) => { const url = new URL(req.url ?? '/', 'http://localhost'); … }`（:139-142），只用 `node:http` 类型，零依赖。服务契约 `dsh-host-webserver\lib\index.js:171-184`：`register(route)` 支持 `kind: "exact" | "prefix"`，重复 (kind, path) 抛 `webserver: duplicate ${route.kind} route "${route.path}"`，返回移除 disposer（:322-329 前缀匹配“最长前缀胜”）。客户端直接 `fetch('/<前缀>/api/…')`（memory-evolve 全篇如此）。
- 状态事件：宿主删除会话后会广播 `'api-session/removed'(sessionId)`（`dsh-api-session-controller\lib\typert.host.js`），客户端控制器已监听（`lib\client.js:3618` `ctx.remote.$on("api-session/removed", …)`）并 `this.sessions.get(sessionId)?.handleRemoved()`（:2872）—— **只要 host 侧真的把会话摘掉，列表/投影会自行对账**，`refresh()` 是兜底。

## 7. 打包（第三方真实配方）

`dsh-memory-evolve\scripts\build.mjs`（esbuild，逐字要点）：
- banner/footer（:71-75）：`` `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {` `` + `'var module = { exports: {} }; var exports = module.exports;'` … footer `'return module.exports; } });'`；`PLUGIN_ID = package.json.name`（:36-37，**必须与 loader entry 的 `name` 完全一致**，否则 “loaded without registering”）。
- `esbuild.build({ bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: EXTERNALS, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } })`（:85-101）。
- `EXTERNALS` 必须**只**含平台种子表的 9 个键；memory-evolve 的列表里有历史残留（`cordis`、`@deepseek-ai/dsh-client-web-react`、`@deepseek-ai/dsh-client-schema-form`、`@deepseek-ai/dsh-client-runtime/client`）之所以不炸，是因为代码从未真的 `require` 它们 —— **照抄会踩坑**。
- 安装：`dsh plugin --profile desktop add <path|git-url>`；`cordis.patch.yml` 由 bundle 自动插入（`- insert: [{ id: <name>, name: <pkg name> }]`），**不要在 profile patch 里重复插同一行**（重复 id 会崩 loader，memory-evolve `cordis.patch.yml:1-10`）。

---

## MINIMAL CLIENT PLUGIN SKELETON

`~/dsh-session-delete/` —— 一个红色危险菜单项 + 确认弹窗 + 真删（host 半边）。

**package.json**
```json
{
  "name": "dsh-session-delete", "version": "0.1.0", "private": true, "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "scripts": { "build": "node scripts/build.mjs" },
  "dsh": { "client": { "platform": "web" }, "bundle": { "patch": "./cordis.patch.yml" } }
}
```

**cordis.patch.yml**
```yaml
- insert:
    - id: session-delete
      name: dsh-session-delete
```

**src/client/index.js**（客户端半边；构建成 `lib/client.js`）
```js
import * as React from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

const NS = 'dsh-session-delete'
const MENU = 'sidebar.workspaces.session.menu.item'
export const inject = ['slots', 'locale', 'sessions']

// 菜单行：只负责「关菜单 + 登记待确认请求」
function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, setDeleteRequest, t }) {
  const [, setMenuOpen] = useMenuOpenState()            // 出厂菜单行同名 hook，返回 [open, setOpen]
  return React.createElement(MenuItemButton, {
    danger: true,                                       // 红色文字/图标 + 红色 hover 底
    separatorBefore: true,                              // 与出厂行分组（发丝线）
    icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
    onSelect: () => { setMenuOpen(false); setDeleteRequest({ sessionId, displayTitle }) },
  }, t('menu.deleteSession'))
}

// 弹窗：内部组件按 sessionId keyed，状态放里面（照抄出厂 ArchiveConfirmForm 的结构）
function DeleteConfirmForm({ request, runDelete, onSettle, t }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const close = () => { if (!busy) onSettle() }
  const confirm = () => {
    setBusy(true); setError(null)
    runDelete(request.sessionId)
      .then(() => { setBusy(false); onSettle() })
      .catch((reason) => { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)) })
  }
  return React.createElement(Modal, {
    open: true, onClose: close, closeLabel: t('close'),
    title: t('confirm.title'),
    description: t('confirm.desc', { title: request.displayTitle || request.sessionId }),
    footer: React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: 'outline', disabled: busy, onClick: close }, t('cancel')),
      // 没有 danger variant：variant=outline + 错误色 token（出厂 deleteAction 的等价写法）
      React.createElement(Button, {
        variant: 'outline', disabled: busy, onClick: confirm,
        style: { color: 'var(--dsw-alias-state-error-primary)' },
      }, t('confirm.action')),
    ),
  },
    busy && React.createElement('div', { role: 'status' }, t('confirm.pending')),
    error !== null && React.createElement('div', { role: 'alert' }, error),
  )
}

function DeleteSessionConfirmOverlay({ useDeleteRequest, clearDeleteRequest, runDelete, t }) {
  const request = useDeleteRequest((pending) => pending)   // selector hook（同出厂 useArchiveRequest）
  if (request === null) return null                         // 早返回在 hook 之后，安全
  return React.createElement(DeleteConfirmForm, {
    request, runDelete, onSettle: clearDeleteRequest, t, key: request.sessionId,
  })
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, {
    zh: { 'menu.deleteSession': '删除会话', 'confirm.title': '删除会话', 'confirm.desc': '将永久删除「{title}」及其全部记录，是否继续？', 'confirm.action': '删除', 'confirm.pending': '正在删除…', 'cancel': '取消', 'close': '关闭', 'confirm.failed': '删除失败' },
    en: { 'menu.deleteSession': 'Delete session', 'confirm.title': 'Delete session', 'confirm.desc': 'Permanently delete "{title}" and all of its records?', 'confirm.action': 'Delete', 'confirm.pending': 'Deleting…', 'cancel': 'Cancel', 'close': 'Close', 'confirm.failed': 'Delete failed' },
  }), `${NS}:dictionaries`)

  const pending = createSnapshotStore(null)                 // 跨条目共享的弹窗状态

  const runDelete = async (sessionId) => {
    const res = await fetch(`/${NS}/api/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${res.status}`)
    await ctx.sessions.refresh()                            // 兜底刷新；宿主也会广播 api-session/removed
  }

  ctx.slots.inject(MENU, () => ctx.slots.register(
    { name: MENU, id: `${NS}.delete`, order: 900, locale: NS, inject: () => ({ hooks: { deleteRequest: pending }, setDeleteRequest: (req) => pending.set(req) }) },
    DeleteSessionMenuItem,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: `${NS}.confirm`, order: 200, locale: NS, inject: () => ({ hooks: { deleteRequest: pending }, clearDeleteRequest: () => pending.set(null), runDelete }) },
    DeleteSessionConfirmOverlay,
  ))
}
```

**src/index.js**（host 半边：真删 + HTTP 路由；`node:http` 零依赖）
```js
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'

const ROOT = join(homedir(), '.dsh', 'sessions')     // 会话根目录：见 §6 布局
const key = (cwd) => cwd === undefined || cwd === '' ? '_no-cwd'
  : `--${(cwd.replace(/[/\\:]+/g, '-').replace(/^-+/, '') || 'root').slice(0, 251)}--`
const seg = (raw) => raw.replace(/[^A-Za-z0-9._-]|~/g, (ch) => '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))

export const inject = ['webServer', 'sessions']

export function apply(ctx) {
  const handler = async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method !== 'POST' || url.pathname !== '/dsh-session-delete/api/delete') return send(404, { ok: false, error: 'not found' })
    try {
      const chunks = []; for await (const c of req) chunks.push(c)
      const { sessionId } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (typeof sessionId !== 'string' || sessionId === '') return send(400, { ok: false, error: 'sessionId required' })
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd   // 取 cwd 才能定位 projectKey（UNVERIFIED：字段名以实际快照为准）
      await rm(join(ROOT, key(cwd), seg(sessionId)), { recursive: true, force: true })
      send(200, { ok: true })
    } catch (error) { send(400, { ok: false, error: error?.message ?? String(error) }) }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-session-delete', handler }), 'session-delete: api')
}
```

**scripts/build.mjs**（要点照抄 memory-evolve，externals 只用种子表）
```js
const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`
const footer = 'return module.exports; } });'
await esbuild.build({ entryPoints: ['src/client/index.js'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: EXTERNALS,
  loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: banner }, footer: { js: footer } })
```
安装：`dsh plugin --profile desktop add C:\...\dsh-session-delete`。

---

## UNVERIFIED

- host 半边的 `ctx.sessions.list.getSnapshot().byId[id].cwd` 字段名：会话行快照的**精确**字段清单未逐个核实（只核实了容器 `{ ids, byId, phase, projectionsBySession }`）。若 `cwd` 不在行内，需改用 `dsh-session-persistence-jsonl` 的 `listProjectDirs`/`listSessionDirs`（:3434）扫描目录反查。
- 会话根目录 `~/.dsh/sessions` 是否可配置（`root` 由 backend 注入，未在插件可见面找到读取入口）；已实测该默认路径存在且布局与 `projectKey` 一致。
- 删除“正在运行的会话”是否需要预检（`WorkspaceArchiveError` / `workspace/session-active` 只覆盖 archive 路径）；`api-session/removed` 广播与文件删除的时序未实测。
- `shell.overlay` 条目的 `standardProps` 清单未在目录中逐字确认；本骨架未依赖它（改用 `inject: ["sessions"]`）。
- `MenuItemButton` 的 `shortcut` 参数需要 `ShortcutCatalogEntry`（本骨架未传快捷键，未验证注册自定义快捷键的流程）。
- `dsh.client.external` 的实际解析（哪个包名可被动态包请求）未实测，本骨架不需要。
