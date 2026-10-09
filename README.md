# dsh-session-delete

当前版本 **0.1.1**（0.1.0 → 0.1.1：修掉「宿主 dispose 写回投影缓存」的时序缺陷，见 §8 第 18 条）。

把「删除会话」做成一等公民的 DSH 插件：**侧栏会话行 `…` 菜单注入红色危险项 → 二次确认模态框 → 七阶段删除流水线 → 广播事件并刷新侧栏**。
删除是**永久**的：会话日志会从磁盘上消失，无法用「撤销」找回。

- 宿主半边（Node）：`lib/index.js` + `lib/host/*` + `lib/core/*` —— 拥有文件系统与宿主服务，通过自建 HTTP 路由暴露能力。
- 浏览器半边（预构建懒加载 CJS）：`lib/client.js` —— 注入菜单项、确认模态、toast，并调用 `sessions.refresh()`。
- 状态：核心/宿主/客户端三层共 **70 个测试全部通过**（`node --test "tests/*.test.js"`，core 32 + host 27 + client 11），`tools/doctor.mjs` 在临时 DSH home 上跑通完整七阶段流水线，并由**三次**独立只读对抗式审计逐条复核需求、宿主 API 与绕过面（审计提出的 1 个 blocker + 3 个 major + 其余 minor/info 已全部处理，见 §8）。**已在真实 DSH（desktop profile）里完成端到端验证**：侧栏出现红色「删除会话」、确认后行当场消失、磁盘目录/挂账/投影缓存全部清掉（记录见 §7 末尾）。

---

## 1. 它做什么

1. 会话行的 `…` 菜单里出现 **「删除会话」**（`danger: true`，红色文字/图标/悬停底色，位置在归档之后，`order = 500`）。
2. 点击后立刻关闭菜单并打开确认模态框，模态框会先拉取一次**预览**（真实调用预览接口）：
   - 会话 cwd（取自持久化 header，不是当前工作目录）；
   - 将被删除的目录数与文件数、总占用；
   - 命中的工作区挂账、是否在归档集合/固定集合中、是否会清理投影缓存；
   - 会话是否**运行中**（命中 `workspace/session-activity` 时显示红色警告条，并在提供 `force` 时二次确认）。
   - 「取消」按钮带 `data-modal-autofocus`，打开即聚焦，避免误按回车。
3. 确认后按顺序执行七阶段流水线，**每个阶段独立 `try/catch`**，任一阶段失败只降级继续，绝不让异常逃到宿主：

| # | key | 名称 | 做什么 | 拒绝/失败时 |
|---|-----|------|--------|-------------|
| 1 | `validate` | 校验 ID | 正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$` 防目录穿越；会话必须“已知”（运行态存储或工作区挂账里存在） | **gate**：拒绝 ⇒ 整条流水线中止，**不修改任何数据** |
| 2 | `running-guard` | 运行保护 | `ctx.waterfall('workspace/session-activity', {sessionId})`，非空数组 ⇒ 运行中 | **gate**：无 `force` 拒绝（HTTP 409）；`force: true` 时先 `registry.stopSessionActivity(id)`（内部 `ctx.parallel('workspace/session-stop', …)`） |
| 3 | `workspace-ledger` | 工作区挂账移除 | 优先调用注册表实体原语 `registry.get(workspaceId).detachSession(sessionId)`（宿主自己会写 ISO `updatedAt` 并剪掉指向过期路径的成员）；无实体句柄时退化为 `table.update(id, …)`；服务整体缺失时退化为直接原子编辑 `<storagesRoot>\workspace.json` | 挂账**存在但清理失败** ⇒ `failed`（否则刷新后行会“复活”）；账本不存在 ⇒ `skipped` |
| 4 | `archive-set` | 归档集合清理 | 先调 `registry.unarchiveSession(id)` / `registry.unpinSession(id)`（幂等原语），再校验 `requireState()` 是否已不含该 id；注册表缺少原语时退回 `setState()` | 失败仅告警并降级 |
| 5 | `disk-logs` | 磁盘日志删除 | 扫描 `<sessionsRoot>` 定位该 id 的目录（`*-<编码后的 id>`），整棵删除；**只清理因此变空的 project 目录**；投影缓存**两条路都走**：`ctx.get('storageDomain').get('session_projcache').table('sessions').delete(id)`（绝不 `open()`，否则抛 `already-open`）+ 直接删 `<storagesRoot>\session_projcache\sessions\<id>.json`（只删 domain 记录不够：domain 的下一次 flush 会把文件写回来） | 失败 ⇒ `deleted=false`（`disk-logs` 是唯一“磁盘关键”阶段）；Windows 文件占用时记入 `leftover`，等第 6 阶段摘除句柄后重试 |
| 6 | `memory` | 内存摘除 | `sessions.get(id)` → `sessions.flush(session)`（释放 JSONL writer）→ `liveEntryFor(session)` → `detachEntered(entry)`（宿主**没有**按 id 删除的 API；`detachEntered` 会顺带触发 `session/disposed`，live 会话因此连带完成第 7 阶段）；**摘除后再清一次投影缓存**——dispose 会给会话写最后一份 projection 快照，真实环境里这一步会把第 5 阶段刚删掉的缓存文件重新写出来（实测延迟 27 s，见 §8 第 18 条） | 非运行态/服务缺失 ⇒ `skipped`（靠第 5、7 阶段兜底）；摘除后的缓存重清失败只记入 `extra.cacheSweep`，不把一次成功的摘除判成失败 |
| 7 | `broadcast` | 广播事件 | `ctx.emit('api-session/removed', sessionId)` —— 客户端 `sessions` store 收到后移除该行 | 广播失败 ⇒ `failed`（不再假装成功）；**第 5 阶段失败时本阶段主动 `blocked`**：磁盘日志还在，隐藏行只会让用户以为删掉了，刷新/重启后又“复活” |

4. 成功后 toast 提示，并调用 **`sessions.refresh()`** 刷新侧栏列表（该 API 在 `dsh-client-ui-workspace` 里是真实存在的：会重新拉取持久化会话列表）。
5. 若流水线在 gate 上被拒绝，前端展示「未删除任何数据」并保持会话不变。

返回的报告是结构化的（`report.stages[]` 含每阶段 `status/ms/detail/error`，以及 `deleted/partial/aborted/refused/warnings`），宿主日志里有逐阶段记录。

---

## 2. 目录结构

| 路径 | 角色 |
|------|------|
| `package.json` | `dsh.client`（`platform: web`、`inject: []`）+ `dsh.bundle.patch` + `exports["./client"]` |
| `cordis.patch.yml` | bundle patch：向 profile 插件名册插入 `id: session-delete` 行 |
| `lib/index.js` | Cordis 入口：`name` / `inject = []` / `apply()`，装配 runtime + stages + HTTP handler |
| `lib/host/runtime.js` | 宿主能力适配器：路径解析、会话头、运行态、挂账/归档集合读写、活动检查、内存摘除、广播、`preview()` |
| `lib/host/stages.js` | 把 runtime 能力接成七个阶段函数（含 `force` 语义与磁盘重试） |
| `lib/host/http.js` | `/session-delete/*` 路由：`{ok,value}` / `{ok,error}` 信封、来源/令牌/JSON 准入、400/403/405/409/413/415 守卫 |
| `lib/core/paths.js` | `encodeSegment` / session 目录名与 id 的互推、非法 id 判定 |
| `lib/core/scan.js` | 目录发现与统计（`describeDir` / `removeSessionDirs` / 投影缓存候选） |
| `lib/core/ledger.js` | `workspace.json` 的纯函数式读写改（含原子替换、校验 `verdict`、重复 id 全清） |
| `lib/core/pipeline.js` | 七阶段定义 `STAGES`、`runDeletionPipeline`、`summarizeReport`、`describeError` |
| `lib/client.js` | 浏览器半边（手写懒加载 CJS：`window.__ModuleLoader__.load({id, factory})`） |
| `tests/core.test.js` | 32 个纯逻辑用例（路径编码、扫描、账本、流水线语义） |
| `tests/host.test.js` | 27 个宿主用例（真实临时 DSH home + stub 服务 + 伪 req/res + 阶段级 fake runtime，含“摘除后重扫投影缓存”的时序断言） |
| `tests/client-bundle.test.js` | 11 个客户端契约/行为用例（自建 module loader 替身 + 自建 hook 运行时驱动真实渲染状态 + 参照 `.ref/` 的槽位/样式/exports 交叉核对） |
| `tests/helpers/client-contract.mjs` | 槽位名/顺序常量，防契约漂移 |
| `tools/doctor.mjs` | 手工自检：构造临时 home 跑一次流水线（`--live --registry --busy --force`） |
| `tools/asar.mjs` | 解包/读取 DSH asar 安装体的辅助脚本 |
| `docs/research/r1…r4` | 四份源码级研究报告：客户端注入点、宿主会话生命周期、客户端 store/refresh、打包与安装 |

---

## 3. 安装

安装会写入 **desktop profile**：`C:\Users\ming\.dsh\profiles\desktop`（`package.json` / `pnpm-lock.yaml` / `node_modules`）。

> 先备份 `package.json` 与 `pnpm-lock.yaml`，并**退出 DSH 桌面端**再安装（CLI 写 profile 时会阻止 profile 启动）。

### 方式 A：CLI（推荐）

```powershell
dsh plugin --profile desktop add "link:D:\AI_Work\开发\删除会话插件"
```

### 方式 B：手动

```powershell
$NODE = "D:\AI_Programs\Deepseek-harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "D:\AI_Programs\Deepseek-harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
Set-Location "C:\Users\ming\.dsh\profiles\desktop"
& $NODE $PNPM add "link:D:/AI_Work/开发/删除会话插件"    # 只建 junction，不下载
& $NODE $PNPM install                                    # link: 也必须跑一次，写 lockfile importer
```

然后把 `"dsh-session-delete"` **追加到 `dsh.profile.bundles` 数组末尾**（顺序即 bundle 层顺序）。`link:` 指到本目录，所以后续只改本目录的代码即可，不需要重新安装。

**不要**再往 profile 自己的 `cordis.patch.yml` 里插一行同名插件：`cordis.patch.yml`（bundle patch）已经会插入，重复 id 会让加载器崩。

### 生效与验证

- **首次安装**：本机实测**宿主半边不需要重启**——改 `dsh.profile.bundles` 会让 profile 实时重组并把插件挂上（`/session-delete/health` 立刻 200），客户端半边**刷新页面（F5）**即可看到菜单项。
- **改完 `lib/` 之后要不要重启？** 取决于 profile 有没有把本目录加进 `hmr.root`：bundle 基础层把 `hmr.root` 设为 `[]`（模块根是 opt-in，见 `@deepseek-ai/dsh-base` 的 patch：`# Profile configuration reloads by default; module roots are opt-in.`），此时**必须完整重启 DSH** 才能加载新的宿主代码。想把宿主半边也变成热更新，就在 profile 的 `cordis.patch.yml` 里加一行（本机已按此配置，备份见 `cordis.patch.yml.bak-hmr-root-20261009`）：

  ```yaml
  - id: hmr
    name: "@deepseek-ai/dsh-hmr"
    config:
      root:
        - "D:/AI_Work/开发/删除会话插件/lib"
  ```

  之后 `dsh-hmr` 会监视 `lib/`：改动任一模块（含 mtime 变化）都会清掉该模块图的 ESM/CJS 缓存、重新 import 入口，并把新插件热替换进同一个 entry（token 会轮换，客户端遇到 403 `invalid-token` 会自动重新取一次）。本机验证方式：把 `lib/index.js` 的 `version` 从 `0.1.0` 提到 `0.1.1` 并 touch `lib/**/*.js`，约 3 秒后 `/session-delete/health` 就返回 `0.1.1`。改 `lib/client.js` 仍由 `dsh-client-hmr`（500 ms 轮询）热替换，或直接刷新页面。
- 验证宿主已挂载：

  ```powershell
  Invoke-RestMethod http://127.0.0.1:19387/session-delete/health
  # -> { ok: true, value: { name: 'dsh-session-delete', version: '0.1.1', token: '<uuid>', requireToken: true } }
  ```

  `version` 同时是「运行中的进程加载的是哪一代代码」的判据。

- 然后在侧栏任意会话行点 `…` 找到「删除会话」。

### 发布到 GitHub

可以直接公开：`package.json`、`cordis.patch.yml`、`lib/`、`tools/`、`tests/`、`README.md`、`LICENSE`、`.gitignore`。

**不要**提交 `.ref/`——那是从 `resources/app.asar` 解包出来的 DSH 应用源码（本机 11,470 个文件 / 112.5 MB，属第三方代码），`.gitignore` 已排除。`docs/research/r1–r4.md` 是本项目自己写的研究笔记，但内含 DSH 内部源码的 `file:line` 引用与片段，公开前请自行过一遍（不想公开就把它加进 `.gitignore`）。本目录也没有 `node_modules`（依赖是装在 profile 里的 junction）。

首次发布：

```powershell
git init
git add -A
git commit -m "dsh-session-delete 0.1.1"
git remote add origin https://github.com/<you>/dsh-session-delete.git
git push -u origin main
```

别人安装（`dsh plugin add` 会自己把带 `dsh.bundle.patch` 的依赖追加进 `dsh.profile.bundles`）：

```powershell
dsh plugin --profile desktop add github:<you>/dsh-session-delete
```

> `package.json` 里的 `"private": true` 只挡 `npm publish`，不影响 `github:`/`link:` 安装；打算同时发 npm 就把它改成 `false`。

---

## 4. 卸载与回滚

```powershell
dsh plugin --profile desktop remove dsh-session-delete
```

手动回滚：

1. 从 `dsh.profile.bundles` 里删掉 `"dsh-session-delete"`；
2. `& $NODE $PNPM remove dsh-session-delete`（或直接恢复备份的 `package.json` / `pnpm-lock.yaml` 并 `pnpm install`）；
3. 重启桌面端。`node_modules` 里是 junction，不会往项目目录写任何东西；本项目目录可整体删除。

---

## 5. 配置

在 `cordis.patch.yml` 的 `insert` 行加 `config`，或在 profile patch 里覆盖：

```yaml
- insert:
    - id: session-delete
      name: 'dsh-session-delete'
      config:
        allowForce: false            # 彻底禁止“强制删除运行中的会话”
        sessionsRoot: 'D:\dsh-data\sessions'
        storagesRoot: 'D:\dsh-data\storages'
        ledgerFile: 'D:\dsh-data\storages\workspace.json'
        dshHome: 'D:\dsh-data'
```

| 键 | 默认值 | 说明 |
|----|--------|------|
| `dshHome` | `config.dshHome` → `$env:DSH_HOME` → `~\.dsh` | 所有路径的基准 |
| `sessionsRoot` | `<dshHome>\sessions` | 会话日志根目录 |
| `storagesRoot` | `<dshHome>\storages` | 存储域根目录 |
| `ledgerFile` | `<storagesRoot>\workspace.json` | 工作区挂账账本 |
| `allowForce` | `true` | `false` 时 `force` 被忽略（HTTP 403），运行中的会话一律拒删 |
| `requireToken` | `true` | `false` 时不校验 `X-Session-Delete-Token`（仅本机脚本场景；来源校验仍然生效） |

---

## 6. HTTP API（宿主半边）

前缀 `/session-delete`。DSH 的 `webServer` 自身不做鉴权（官方 `/api` 走 `connection.admit`，且 `dsh-host-webserver` 里既无 origin 校验也可能绑 `0.0.0.0`），所以本插件自带两层准入，**除 `/health` 外每一条路由都会经过**：

1. **来源校验**：`sec-fetch-site` 被 trim 后为 `cross-site` ⇒ 403 `cross-site-blocked`；`Origin: null`（不透明源：沙箱 iframe、`data:` 页面）⇒ 403 `cross-origin-blocked`；`Origin` 的 host 与 `Host` **大小写不敏感**比较不一致 ⇒ 403 `cross-origin-blocked`；带 `X-Forwarded-Proto` 时还会比较协议（https 页面不等于 http API）。**局限（务必知道）**：这一层只约束浏览器——`Origin`/`Host` 都是请求自带的，能伪造请求头的非浏览器调用方可以两边一起伪造。**唯一真正的凭证是下面的令牌**；想在没有令牌的情况下防住简单请求注入，就该保持 `requireToken: true`（默认）。
2. **令牌**：除 `GET /session-delete/health` 外的所有路由（含预览）都必须带随进程启动生成的一次性令牌 `X-Session-Delete-Token`（否则 403 `invalid-token`，比较用 `crypto.timingSafeEqual`）。令牌只能通过同源 `GET /session-delete/health` 读到（响应不带 CORS 头，跨站脚本读不到），因此跨站请求连预览都发不出去。
3. **状态变更请求**（POST）：`Content-Type` 必须**严格**是 `application/json`（可带参数，如 `; charset=utf-8`），否则 415 `unsupported-media-type`——`application/jsonp`、`text/plain` 这类浏览器无需 CORS 预检就能发出的类型一律拒绝。

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| `GET` | `/session-delete/health` | — | `{ok:true,value:{name,version,token,requireToken}}`（不回显任何路径） |
| `POST` | `/session-delete/preview` | `{sessionId}`（也支持 `?sessionId=`） | `{ok:true,value:{valid,known,live,cwd,activity,dirs,cwds,totalBytes,totalFiles,cache,workspaces,archived,pinned,registryAvailable,forceAllowed}}` |
| `POST` | `/session-delete/delete`（别名 `/session-delete`，尾斜杠会先被规范化） | `{sessionId, force?}` | `{ok:report.deleted, value:report}`；被 gate 拒绝 ⇒ **409** |

错误信封统一为 `{ok:false,error:{code,message}}`：

| code | 状态 | 触发 |
|------|------|------|
| `cross-site-blocked` / `cross-origin-blocked` | 403 | 跨站来源 / 跨源或 `Origin: null` / host 或协议不匹配 |
| `invalid-token` | 403 | 除 `/health` 外的路由缺少令牌或令牌不对 |
| `invalid-session-id` | 400 | id 缺失、非法或含穿越字符 |
| `force-not-allowed` | 403 | `force: true` 但配置 `allowForce: false` |
| `method-not-allowed` | 405 | `delete` 收到非 POST |
| `unsupported-media-type` | 415 | POST 不是 `application/json` |
| `body-too-large` | 413 | 请求体 > 256 KB：先回 413 再**排空**（`req.resume()`，不 `destroy`）余量并 `Connection: close`；`destroy` 会让仍在发送的客户端只看到 `ECONNRESET` 而读不到 413 |
| `bad-url` / `invalid-json` | 400 | URL 无法解析 / 请求体不是合法 JSON（调用方的错，不是服务端故障） |
| `internal-error` | 500 | 其他异常（详情进宿主日志） |

> 想彻底关掉令牌检查（仅限本机自用脚本）：配置 `requireToken: false`，此时 `health` 里 `requireToken: false` 且不带 `token` 字段。来源校验无法关闭。

---

## 7. 测试与自检

```powershell
# 打包运行时的 node（本机实测路径；DSH 安装体内的 primary-runtime 同样可用）
$NODE = "C:\Users\ming\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $NODE --test "tests/*.test.js"                 # 70 passed（core 32 + host 27 + client 11）
& $NODE tools/doctor.mjs --live --busy --force   # 临时 home 上跑一遍完整流水线并打印报告
```

`tools/doctor.mjs` 会在系统临时目录里造一个假 DSH home（会话日志 + 工作区账本），按参数勾选“运行态服务 / 真正 detach / 运行中会话 / force”，打印每阶段 `status/ms/detail`，用来在真实宿主之外复现宿主行为；它**永不触碰真实 `~/.dsh`**。

`tests/client-bundle.test.js` 除了用自己的 `window.__ModuleLoader__` 替身跑 `lib/client.js`，还会**交叉核对 `.ref/` 里的真实客户端源码**：槽位 `sidebar.workspaces.session.menu.item` 仍以 `kind: "list"` / `scope: "root"` 声明、ownerProps 仍含 `sessionId`/`displayTitle`、仍注入 `useMenuOpenState`、`MenuItemButton` 的 `danger` 仍由 `--dsw-alias-state-error-primary` 上色、consumed primitives 仍是真实导出。`.ref/` 不存在时该用例自动 skip（`t.skip`）。

客户端行为用例使用一个**自建的最小 hook 运行时**（`createHookRuntime()`：跨渲染保留 state/ref、执行 effect、state 未收敛就继续重渲染），因此断言的是用户真实看到的按钮状态——预览进行中确认键 `disabled`、预览返回后启用、运行中会话变「强制停止并删除」并先出红色告警、删除进行中确认键锁死而取消键仍可点、成功后才 toast + `sessions.refresh()` + 关窗、宿主 409 拒绝时保留模态并渲染「失败详情」（失败阶段与残留路径），以及重试自动带上 `force: true`。

### 真实 DSH 端到端验证（本机 desktop profile，已完成）

安装形态：`C:\Users\ming\.dsh\profiles\desktop\package.json` 里以 `link:D:/AI_Work/开发/删除会话插件` 依赖本目录（`node_modules\dsh-session-delete` 是 junction），`dsh.profile.bundles` 末尾追加 `dsh-session-delete`；回滚备份为同目录下 `package.json.bak-session-delete-20261009104827` 与 `pnpm-lock.yaml.bak-session-delete-20261009104827`。

| 验证项 | 实测结果 |
|--------|----------|
| 宿主半边是否需重启 | **不需要**：改 `bundles` 触发 profile 实时重组，`GET http://127.0.0.1:19387/session-delete/health` → 200 `{name:'dsh-session-delete',version:'0.1.0',token:'<uuid>',requireToken:true}`（加 `hmr.root` 后热更新到 `0.1.1`，见 §3） |
| 客户端半边 | 刷新页面（F5）后，会话行 `…` 菜单里出现**红色「删除会话」** |
| 预览接口读真实数据 | 对一个真实会话（1 个 `session.v4.jsonl.zstd`、27,561 B）返回 `dirs`（`generation: v4`、`locked: false`）、`cwds`、`workspaces`（`workspaceId 38b23fb6-…`、title「删除会话插件」）、`registryAvailable/forceAllowed: true`；对**正在跑 turn + pwsh 任务**的会话返回 `activity: [{kind:'turn'},{kind:'job',items:[…]}]` ⇒ 活动探测真实可用 |
| 界面删除（用户操作） | 对新建的测试会话 `Greeting`（`session-92b15655-d3a4-46b4-8c89-9c58fb044938`）点「删除会话」→ 确认：**行当场消失**，右下角出现绿色**「会话已删除」** |
| 会话目录 | `sessions\--D-AI_Work-~5F00~53D1-~5220~9664~4F1A~8BDD~63D2~4EF6--\session-92b15655-…`（1 file / 27,561 B）→ 确认后 **27.1 s 内实测消失**，之后不再出现 |
| 工作区挂账 | `workspace.json`：`tables.workspaces['38b23fb6-…'].sessionIds` 由 `['session-92b15655-…','session-e5594e8a-…']` → `['session-e5594e8a-…']`，整个文件已不含该 id；`global.archivedSessionIds` 未被波及；`updatedAt` 为 ISO 字符串 |
| 投影缓存 | 旧代码在此暴露一个真缺陷：摘除后宿主又写回了缓存文件（10:59:00，比删除晚约 27 s，里面还带着 `Greeting` 标题）⇒ 已修（第 6 阶段摘除后重扫，见 §8 第 18 条）；遗留的孤儿文件已手工清除，其后 12 s 未被重写 |

> 说明：DSH 自己的 `/`、`/api/boot` 走 `connection.admit`（未带凭据一律 401），所以「页面真的渲染出菜单、点确认真的删掉」只能由浏览器侧确认——上表第 2、4 行就是浏览器侧的人工确认结果。

---

## 8. 设计取舍与已知限制

1. **没有“按 id 删除会话”的宿主 API**：`sessions` 只暴露 `get` / `liveEntryFor` / `detachEntered`。内存阶段因此走 `detachEntered`，对**运行态**会话有效；对非运行态（进程重启后）会话该阶段为 `skipped`，行消失依赖第 7 阶段广播 + 第 5 阶段删盘后 `session-query-sqlite` 的自愈对账。
2. **Windows 文件锁**：宿主可能仍持有 `session.v4.jsonl` 句柄，所以磁盘阶段先删、删不掉的记入 `leftover`，等第 6 阶段摘除内存后再重试一次，并把最终残留路径写进报告。
3. **目录定位靠扫描，不靠 cwd 反推**：会话目录里的 slug 是**创建时**的 cwd 快照，之后切换工作目录会与当前 cwd 不一致（本项目会话自己就是这种情况）。扫描限定深度并逐个校验目录名后缀，避免误删。
4. **拒绝删除“未知会话”**：会话来路不明时宁可拒绝（gate 中止），也不去赌一个可能拼错的 id。
5. **客户端不蹭 ui-workspace 的私有 toast/store**：那两样都没导出，插件自建 `shell.overlay` 槽、自建快照 store、自建 CSS。
6. **红色确认按钮**：UI primitives 的 `Button` 只有 `primary/ghost/outline/toolbar`，所以用 `variant: 'outline'` + 自带类名 `.session-delete-confirm`（颜色取 `var(--dsw-alias-state-error-primary)`）。
7. **自建 HTTP 路由而不是 typert**：typert 需要严格 codec 与生成器产物，成本远高于一次同源 `fetch`；插件只在浏览器半边调用自家路由。
8. **不修改宿主快照/索引表**：SQLite 会话索引由宿主自愈对账，插件只删日志与挂账，避免和宿主抢写入。**不删附件**：`dsh-attachment-local` 是内容寻址且跨会话共享的，删了会连累别的会话。
9. **`inject = []`**：三个宿主能力（`sessions` / `workspaceRegistry` / `webServer`）都按需查找，缺失就降级为 `skipped`，插件永远不会拖垮宿主启动。
10. **自带请求准入（审计后加固）**：审计指出宿主 `webServer` 自身不做鉴权，而插件路由能永久删数据，因此加了「来源校验 + JSON 强制 + 一次性令牌」三层（见 §6）；令牌只走同源 `fetch`，跨站脚本因无 CORS 头读不到，比较用 `crypto.timingSafeEqual`。客户端同时加了 20 s `AbortController` 超时（取令牌 8 s）与**同步的在飞守卫**（`react.useRef`），宿主无响应或在飞时不能重复提交；令牌轮换（DSH 重启）会触发一次自动重取重试；`deleting` 期间允许关闭模态（不会留下打不开的弹窗）。
11. **账本文件兜底做丢更新检测 + 进程内串行**：服务不可用时直接改 `workspace.json` 有覆盖风险，所以走「stat → 读 → 改 → 再 stat → 一致才 rename」的乐观重试（最多 3 次），仍冲突就如实报 `ledger-contended`，不假装成功。同一进程内的并发删除会把这段 read-modify-write 串成一条 promise 链（第二次审计实测：不串行 + 固定临时文件名会让两个写入互相 `rename` 掉对方的 tmp，把 `workspace.json` 写成非法 JSON），临时文件名也改成“pid + 序号 + 随机后缀”并对失败路径做 `rm` 清理。
12. **失败详情可见**：阶段级 `detail`/`error`/`leftover` 会渲染在模态的「失败详情」区（此前只显示通用 HTTP 错误），409 也会把 `report` 一并带回；**返回值型失败**（`status: 'failed'`）同样写进 `warnings`，避免降级跑完却看起来一切正常。
13. **运行中会话默认仍需 `force`**：UI 在预览里明确写出「该会话正在运行（N 项活动）」，确认按钮变成「强制停止并删除」才带 `force: true`；`allowForce: false` 时该按钮不可用。
14. **磁盘没清干净就不广播**：`api-session/removed` 是客户端隐藏该行的唯一信号，若第 5 阶段失败（Windows 文件占用）仍广播，就会得到「侧栏行没了但日志还在、重启复活」的状态。因此第 7 阶段此时返回 `blocked` 并在模态里列出残留路径；只有第 6 阶段摘除句柄后重试成功，才继续广播。广播本身失败也会如实标 `failed`（`ctx.emit` 不可用时不会假装成功）。
15. **重复挂账一并清除**：`workspace.json` 里同一 id 出现两次时，第 3 阶段会删掉**全部**出现（旧实现只 `splice` 一处，会留下幽灵挂账并在刷新后复活）。
16. **插槽注册的卸载幂等**：`slots.inject` 返回的 disposer 与插件自身 scope 可能都触发卸载，客户端因此用一次性标志 + 逐个 `try/catch` 调用，避免「已释放」异常逃出卸载路径。
17. **客户端测试的边界**：`tests/client-bundle.test.js` 用自建 hook 运行时驱动真实渲染状态，但它仍不是浏览器——没有 DOM、没有真实 `Modal` 焦点管理/Escape、没有真实 `fetch` 与 React 调度，因此「菜单项真的出现在侧栏、弹窗外观、`sessions.refresh()` 真的刷新了列表」只能在真实 DSH 进程 + 浏览器里验证。**已在真实 DSH 里做过一轮（见 §7 末尾）**，但每次改动客户端后仍建议复验一次。
18. **投影缓存必须在内存摘除之后重扫一次**：`session_projcache` 的 domain 记录删掉不等于文件消失——宿主在会话 dispose 时会再写一份最终 projection 快照。真实环境实测：删除成功约 27 s 后，`<storagesRoot>\session_projcache\sessions\<id>.json` 又被写回（内容里还带着会话标题），而 `workspaceRegistry` 的 header 缓存因此继续报 `sessionKnown(id) === true`（`dsh-workspace/lib/index.js:612-617` 的缓存 `headers` 从不按 id 逐条清理）。所以第 5 阶段改成「domain 记录 + 文件」两条路都删，第 6 阶段摘除后再扫一遍，兜住这次写回。

---

## 9. 故障排查

| 现象 | 排查 |
|------|------|
| `…` 菜单里没有「删除会话」 | 客户端插件没加载：确认 `bundles` 里有 `dsh-session-delete`、`node_modules` 里有 junction、已重启 + 刷新页面；再确认槽位 `sidebar.workspaces.session.menu.item` 仍是 `kind: "list"`（跑 `tests/client-bundle.test.js` 会交叉核对 `.ref/` 真实契约） |
| 确认框一直转圈/报网络错 | 宿主路由没挂上：`/session-delete/health` 是否 200；`webServer` 能力是否可用；客户端 20 s 超时会提示「宿主无响应」 |
| 提示 403 `invalid-token` | DSH 重启后令牌轮换：刷新页面即可（客户端会自动重取一次令牌并重试一次） |
| 提示 403 `cross-site-blocked` / `cross-origin-blocked` | 请求来源不是本页面（代理、反代改写 `Host`、或从别的站点触发） |
| 会话删掉又“复活” | 第 3 阶段失败（挂账没清干净）——宿主日志搜 `[session-delete]`；`workspace.json` 是否可写 |
| 提示部分降级 | 报告里 `warnings` / 各阶段 `status`：`skipped` = 能力缺失，`failed` = 真失败，`blocked` = gate 拒绝或“磁盘没清干净所以不广播”（见 §8 第 14 条） |
| 磁盘上还有残留目录 | 文件被占用（宿主仍开着句柄）：关闭该会话后再删，或重启 DSH 后重试；预览里若提示锁文件，先关闭该会话 |
| 运行中的会话删不掉 | 这是设计行为：默认必须显式 `force`；要彻底禁止就配 `allowForce: false` |

---

## 10. 研究依据

四份源码级报告在 `docs/research/`：`r1-client-ui-injection.md`（菜单/模态/槽位/本地化契约）、`r2-host-session-lifecycle.md`（宿主会话生命周期与可用的删除面）、`r3-client-store-refresh.md`（客户端 store、`refresh()`、`api-session/removed` 事件链）、`r4-packaging-and-install.md`（`dsh.client` / bundle patch / profile 安装与 HMR 行为）。结论均标注了 `dsh-*/lib/*.js:行号` 出处。
