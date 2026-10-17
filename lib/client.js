window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// Only frozen platform modules may be required here. The seed table of
		// DSH 0.2.0-rc.2 is exactly: react, react/jsx-runtime, react-dom,
		// react-dom/client, @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
		// @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
		// @deepseek-ai/dsh-client-ui-dockkit. (@deepseek-ai/dsh-client-runtime
		// does not exist — do not copy it from older plugins.)
		var react = require("react");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		var h = react.createElement;
		var NS = "session-delete";
		var VERSION = "0.2.1";
		var MENU_SLOT = "sidebar.workspaces.session.menu.item";
		var OVERLAY_SLOT = "shell.overlay";
		/** After pin(100) / rename(200) / fork(300) / archive(400): last, and destructive. */
		var MENU_ORDER = 500;

		var DICT = {
			zh: {
				"menu.deleteSession": "删除会话",
				"actions.delete": "删除会话",
				"workspace.menu.deleteAll": "删除所有会话",
				"workspace.menu.deleteAllCount": "删除所有会话（{n} 个）",
				"workspace.dialog.title": "删除该工作区的所有会话",
				"workspace.dialog.desc": "此操作不可撤销：该工作区内的所有会话记录、磁盘日志与挂账都会被清除，工作区本身保留。",
				"workspace.dialog.workspace": "工作区",
				"workspace.dialog.path": "路径",
				"workspace.dialog.sessions": "会话数量",
				"workspace.dialog.sessionsValue": "{n} 个",
				"workspace.dialog.running": "运行中",
				"workspace.dialog.runningValue": "{n} 个（默认拒绝，需要强制模式）",
				"workspace.dialog.disk": "磁盘",
				"workspace.dialog.archived": "已归档",
				"workspace.dialog.empty": "该工作区没有可删除的会话",
				"workspace.dialog.loading": "正在检查工作区…",
				"workspace.dialog.runningHint": "其中 {n} 个会话正在运行；强制模式会先停止其活动再删除。",
				"workspace.dialog.forceDelete": "强制删除全部",
				"workspace.dialog.delete": "删除全部会话",
				"workspace.dialog.progress": "正在删除 {done}/{total}…",
				"workspace.dialog.progressFailed": "已删除 {done}/{total}，{failed} 个未能删除",
				"workspace.dialog.report": "未删除的会话",
				"workspace.dialog.retry": "重新检查",
				"workspace.toast.deleted": "已删除工作区中的 {n} 个会话",
				"workspace.toast.partial": "已删除 {done}/{total} 个会话，{failed} 个未删除",
				"dialog.title": "永久删除该会话",
				"dialog.desc": "此操作不可撤销：会话记录、磁盘日志与工作区挂账都会被清除。",
				"dialog.session": "会话",
				"dialog.location": "位置",
				"dialog.disk": "磁盘",
				"dialog.workspace": "工作区挂载",
				"dialog.state": "状态",
				"dialog.busy": "该会话正在运行（{n} 项活动），删除前需要先强制停止。",
				"dialog.idle": "未在运行",
				"dialog.archived": "已归档",
				"dialog.pinned": "已置顶",
				"dialog.none": "无",
				"dialog.noLogs": "磁盘上没有该会话的日志",
				"dialog.files": "{files} 个文件（{size}）",
				"dialog.deleting": "正在删除…",
				"dialog.loading": "正在检查会话…",
				"dialog.cancel": "取消",
				"dialog.delete": "删除会话",
				"dialog.forceDelete": "强制停止并删除",
				"close": "关闭",
				"dialog.forceDisabled": "宿主配置禁止强制删除运行中的会话。",
				"dialog.locked": "检测到会话目录中的锁文件：若删除失败，请先关闭该会话，或重启 DSH 后重试。",
				"dialog.linked": "会话目录是目录链接（junction/符号链接），删除时会连同链接指向的真实目录一起清除（其中非会话文件会保留）。",
				"dialog.report": "失败详情",
				"dialog.leftover": "残留路径",
				"dialog.timeout": "宿主无响应（已超时）",
				"error.hostRefused": "宿主拒绝了请求（HTTP {status}）",
				"toast.deleted": "会话已删除",
				"toast.failed": "删除失败：{message}",
			},
			en: {
				"menu.deleteSession": "Delete session",
				"actions.delete": "Delete session",
				"workspace.menu.deleteAll": "Delete all sessions",
				"workspace.menu.deleteAllCount": "Delete all sessions ({n})",
				"workspace.dialog.title": "Delete all sessions in this workspace",
				"workspace.dialog.desc": "This cannot be undone: every session record, its on-disk logs and workspace ledger entries are removed. The workspace itself is kept.",
				"workspace.dialog.workspace": "Workspace",
				"workspace.dialog.path": "Path",
				"workspace.dialog.sessions": "Sessions",
				"workspace.dialog.sessionsValue": "{n}",
				"workspace.dialog.running": "Running",
				"workspace.dialog.runningValue": "{n} (refused unless forced)",
				"workspace.dialog.disk": "Disk",
				"workspace.dialog.archived": "Archived",
				"workspace.dialog.empty": "This workspace has no deletable sessions",
				"workspace.dialog.loading": "Inspecting workspace…",
				"workspace.dialog.runningHint": "{n} session(s) are running; force mode stops their activity first.",
				"workspace.dialog.forceDelete": "Force delete all",
				"workspace.dialog.delete": "Delete all sessions",
				"workspace.dialog.progress": "Deleting {done}/{total}…",
				"workspace.dialog.progressFailed": "Deleted {done}/{total}; {failed} could not be deleted",
				"workspace.dialog.report": "Sessions not deleted",
				"workspace.dialog.retry": "Re-check",
				"workspace.toast.deleted": "Deleted {n} session(s) in the workspace",
				"workspace.toast.partial": "Deleted {done}/{total} session(s); {failed} failed",
				"dialog.title": "Permanently delete this session",
				"dialog.desc": "This cannot be undone: the record, its on-disk logs and its workspace ledger entries are removed.",
				"dialog.session": "Session",
				"dialog.location": "Location",
				"dialog.disk": "Disk",
				"dialog.workspace": "Workspaces",
				"dialog.state": "State",
				"dialog.busy": "This session is running ({n} active item(s)); force-stop is required before deleting.",
				"dialog.idle": "Not running",
				"dialog.archived": "Archived",
				"dialog.pinned": "Pinned",
				"dialog.none": "None",
				"dialog.noLogs": "No logs on disk for this session",
				"dialog.files": "{files} file(s) ({size})",
				"dialog.deleting": "Deleting…",
				"dialog.loading": "Inspecting session…",
				"dialog.cancel": "Cancel",
				"dialog.delete": "Delete session",
				"dialog.forceDelete": "Force stop and delete",
				"close": "Close",
				"dialog.forceDisabled": "The host configuration forbids force-deleting a running session.",
				"dialog.locked": "A lock file was found in the session directory: if deletion fails, close that session or restart DSH and retry.",
				"dialog.linked": "The session directory is a directory link (junction/symlink); deleting also clears the real directory it points to (files that are not session data are kept).",
				"dialog.report": "Failure details",
				"dialog.leftover": "Leftover path",
				"dialog.timeout": "The host did not respond (timed out)",
				"error.hostRefused": "The host refused the request (HTTP {status})",
				"toast.deleted": "Session deleted",
				"toast.failed": "Delete failed: {message}",
			},
		};

		// `Button` has no `danger` variant, so the destructive confirm button is
		// an outline button painted with the theme's error token (the factory
		// implementation uses a CSS-module class we cannot import).
		var CSS = [
			".session-delete-confirm{color:var(--dsw-alias-state-error-primary,#e5484d)!important;border-color:var(--dsw-alias-state-error-primary,#e5484d)!important}",
			".session-delete-confirm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12))!important}",
			".session-delete-list{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}",
			".session-delete-row{display:flex;gap:8px;font-size:13px;line-height:1.5}",
			".session-delete-key{flex:0 0 auto;opacity:.65}",
			".session-delete-value{flex:1 1 auto;word-break:break-all}",
			".session-delete-warn{margin-top:10px;padding:8px 10px;border-radius:6px;font-size:13px;",
			"color:var(--dsw-alias-state-error-primary,#e5484d);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.1))}",
			".session-delete-error{margin-top:10px;font-size:13px;color:var(--dsw-alias-state-error-primary,#e5484d)}",
			".session-delete-note{margin-top:10px;padding:8px 10px;border-radius:6px;font-size:13px;opacity:.85;",
			"background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.03))}",
			".session-delete-detail{margin-top:8px;padding:8px 10px;border-radius:6px;font-size:12px;opacity:.85;",
			"background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.03))}",
			".session-delete-status{margin-top:10px;font-size:13px;opacity:.75}",
			".session-delete-toast{position:fixed;right:20px;bottom:20px;z-index:60;max-width:360px;padding:10px 14px;border-radius:8px;",
			"font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.18);background:var(--dsw-alias-bg-elevated,#fff);",
			"color:var(--dsw-alias-text-primary,#111);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12))}",
			".session-delete-toast-success{border-color:var(--dsw-alias-state-success-primary,#30a46c)}",
			".session-delete-toast-error{border-color:var(--dsw-alias-state-error-primary,#e5484d)}",
		].join("");

		/* ── tiny observable store (no framework dependency) ───────────────── */

		function createStore(initial) {
			var value = initial;
			var listeners = new Set();
			return {
				get: function () {
					return value;
				},
				set: function (next) {
					var resolved = typeof next === "function" ? next(value) : next;
					if (resolved === value) return;
					value = resolved;
					listeners.forEach(function (listener) {
						try {
							listener();
						} catch (error) {
							/* a broken subscriber must not break the others */
						}
					});
				},
				subscribe: function (listener) {
					listeners.add(listener);
					return function () {
						listeners.delete(listener);
					};
				},
			};
		}

		var useStore = typeof react.useSyncExternalStore === "function"
			? function (store) {
				return react.useSyncExternalStore(store.subscribe, store.get);
			}
			: function (store) {
				var pair = react.useState(store.get);
				var value = pair[0];
				var setValue = pair[1];
				react.useEffect(function () {
					return store.subscribe(function () {
						setValue(store.get());
					});
				}, [store]);
				return value;
			};

		/* ── plugin-scoped state ───────────────────────────────────────────── */

		/** `null` or `{ sessionId, displayTitle }` while a confirmation is open. */
		var dialogStore = createStore(null);
		/** `null` or `{ text, tone, token }` for the transient notice. */
		var toastStore = createStore(null);
		var toastToken = 0;
		/**
		 * Session ids with a delete in flight, tracked outside the component so a
		 * reopened dialog cannot start a second delete for the same session while
		 * the first one is still running.
		 */
		var deletingIds = Object.create(null);
		/**
		 * `null` or the latest `workspace/status` snapshot. Kept outside the
		 * component so closing the dialog does not abort the job or its toast.
		 */
		var workspaceJobStore = createStore(null);
		/** Set while one workspace job is being polled; guards double pollers. */
		var activeJobPoll = null;

		/** Filled in by `apply`: the host context and the bound translator. */
		var runtime = { ctx: null, t: null };

		function t(key, params) {
			var translate = runtime.t;
			if (typeof translate === "function") {
				try {
					return translate(key, params);
				} catch (error) {
					/* fall through to the key */
				}
			}
			return key;
		}

		function messageOf(reason) {
			if (reason instanceof Error) return reason.message;
			if (reason && typeof reason.message === "string") return reason.message;
			return String(reason);
		}

		function humanBytes(bytes) {
			var value = Number(bytes) || 0;
			if (value < 1024) return value + " B";
			var units = ["KB", "MB", "GB"];
			var scaled = value / 1024;
			var index = 0;
			while (scaled >= 1024 && index < units.length - 1) {
				scaled = scaled / 1024;
				index += 1;
			}
			return (scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)) + " " + units[index];
		}

		function clientSessions() {
			var ctx = runtime.ctx;
			if (!ctx) return null;
			try {
				if (typeof ctx.get === "function") {
					var viaGet = ctx.get("sessions");
					if (viaGet) return viaGet;
				}
				return ctx.sessions || null;
			} catch (error) {
				return null;
			}
		}

		function titleOf(sessionId) {
			try {
				var sessions = clientSessions();
				var snapshot = sessions && sessions.list && typeof sessions.list.getSnapshot === "function"
					? sessions.list.getSnapshot()
					: null;
				var row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : null;
				if (row) return row.displayTitle || row.title || sessionId;
			} catch (error) {
				/* the list may not be ready yet */
			}
			return sessionId;
		}

		function clientWorkspaces() {
			var ctx = runtime.ctx;
			if (!ctx) return null;
			try {
				if (typeof ctx.get === "function") {
					var viaGet = ctx.get("workspaces");
					if (viaGet) return viaGet;
				}
				return ctx.workspaces || null;
			} catch (error) {
				return null;
			}
		}

		/** Registry row for one workspace, or null when the store is not ready. */
		function workspaceSnapshotItem(workspaceId) {
			try {
				var workspaces = clientWorkspaces();
				var snapshot = workspaces && workspaces.list && typeof workspaces.list.getSnapshot === "function"
					? workspaces.list.getSnapshot()
					: null;
				var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
				for (var index = 0; index < items.length; index += 1) {
					if (items[index] && items[index].workspaceId === workspaceId) return items[index];
				}
			} catch (error) {
				/* the list may not be ready yet */
			}
			return null;
		}

		/** Authoritative session count from the client registry; null if unknown. */
		function workspaceSessionCount(workspaceId) {
			var item = workspaceSnapshotItem(workspaceId);
			return item && Array.isArray(item.sessionIds) ? item.sessionIds.length : null;
		}

		function workspaceTitle(workspaceId, fallback) {
			var item = workspaceSnapshotItem(workspaceId);
			if (item) return item.title || item.path || workspaceId;
			return fallback || workspaceId;
		}

		function showToast(text, tone) {
			toastToken += 1;
			var token = toastToken;
			toastStore.set({ text: text, tone: tone, token: token });
			setTimeout(function () {
				var current = toastStore.get();
				if (current && current.token === token) toastStore.set(null);
			}, 4500);
		}

		/**
		 * The host refuses to hide a row it still returns: the authoritative
		 * removal is the `api-session/removed` event the host emits while
		 * deleting. `sessions.refresh()` only re-syncs the baseline, so it is a
		 * race net — never the mechanism.
		 */
		function refreshSessions() {
			try {
				var sessions = clientSessions();
				if (sessions && typeof sessions.refresh === "function") {
					var pending = sessions.refresh();
					if (pending && typeof pending.catch === "function") pending.catch(function () {});
				}
			} catch (error) {
				/* refresh is best effort */
			}
		}

		/* ── host bridge ───────────────────────────────────────────────────── */

		/** `null` | Promise<string|null> — the per-boot token from `/health`. */
		var tokenRequest = null;
		var HOST_TIMEOUT_MS = 20000;
		var TOKEN_TIMEOUT_MS = 8000;

		/**
		 * The host route demands a per-boot token that only a same-origin caller
		 * can *read* (`GET /session-delete/health` answers without CORS headers),
		 * so a cross-site page can neither learn it nor forge a delete. Fetch it
		 * once per page and cache the promise.
		 */
		function requestToken() {
			if (tokenRequest) return tokenRequest;
			tokenRequest = fetchWithTimeout(
				"/session-delete/health",
				{ method: "GET", headers: { accept: "application/json" } },
				TOKEN_TIMEOUT_MS
			)
				.then(function (response) {
					return response.json().catch(function () {
						return null;
					});
				})
				.then(function (body) {
					return body && body.ok === true && body.value && typeof body.value.token === "string"
						? body.value.token
						: null;
				})
				.catch(function () {
					tokenRequest = null;
					return null;
				});
			return tokenRequest;
		}

		/**
		 * `fetch` with an abort deadline: a host that never answers must not
		 * leave the modal in a state the user cannot leave.
		 */
		function fetchWithTimeout(url, options, timeoutMs) {
			var controller = typeof AbortController === "function" ? new AbortController() : null;
			var timer = setTimeout(function () {
				if (controller) {
					try {
						controller.abort();
					} catch (error) {
						/* already settled */
					}
				}
			}, timeoutMs);
			var init = { method: options.method, headers: options.headers };
			if (options.body !== undefined) init.body = options.body;
			if (controller) init.signal = controller.signal;
			return fetch(url, init).then(
				function (response) {
					clearTimeout(timer);
					return response;
				},
				function (reason) {
					clearTimeout(timer);
					var aborted = controller && controller.signal && controller.signal.aborted === true;
					var error = new Error(aborted ? t("dialog.timeout") : messageOf(reason));
					error.code = aborted ? "timeout" : "network-error";
					error.cause = reason;
					throw error;
				}
			);
		}

		function postHost(path, payload, token) {
			var headers = { "content-type": "application/json" };
			if (typeof token === "string" && token.length > 0) headers["x-session-delete-token"] = token;
			return fetchWithTimeout(
				path,
				{ method: "POST", headers: headers, body: JSON.stringify(payload || {}) },
				HOST_TIMEOUT_MS
			).then(function (response) {
				return response
					.json()
					.catch(function () {
						return null;
					})
					.then(function (body) {
						return { status: response.status, body: body };
					});
			});
		}

		/** Turn one `{ ok, value | error }` envelope into a value or a rich error. */
		function unwrapHost(result) {
			var body = result.body;
			if (body && body.ok === true) return body.value;
			var error = new Error(
				body && body.error && body.error.message
					? body.error.message
					: t("error.hostRefused", { status: result.status })
			);
			error.code = body && body.error ? body.error.code : undefined;
			error.status = result.status;
			// A refusal (`409`) carries the pipeline report as `value`: keep it so
			// the dialog can show which stage failed and what was left behind.
			error.report = body ? body.value : undefined;
			throw error;
		}

		/**
		 * Call the plugin's own HTTP route. Responses are
		 * `{ ok: true, value }` / `{ ok: false, error }`; a refusal also carries
		 * `value` (the pipeline report) so the dialog can explain itself.
		 */
		function callHost(path, payload) {
			return callHostOnce(path, payload, true);
		}

		/** One call, retried once when the host restarted and rotated its token. */
		function callHostOnce(path, payload, allowRetry) {
			return requestToken()
				.then(function (token) {
					return postHost(path, payload, token);
				})
				.then(function (result) {
					var stale =
						result.status === 403 &&
						result.body &&
						result.body.error &&
						result.body.error.code === "invalid-token";
					if (stale && allowRetry) {
						tokenRequest = null;
						return callHostOnce(path, payload, false);
					}
					return unwrapHost(result);
				});
		}

		/* ── menu entry ────────────────────────────────────────────────────── */

		/**
		 * `sidebar.workspaces.session.menu.item` row: `danger: true` is the
		 * primitive's own red label + red icon + red hover, so no CSS hack is
		 * needed for the requirement's "红色危险样式".
		 */
		function DeleteSessionMenuItem(props) {
			var sessionId = props.sessionId;
			var displayTitle = props.displayTitle;
			var useMenuOpenState = props.useMenuOpenState;
			var open = useMenuOpenState ? useMenuOpenState() : [false, function () {}];
			var setMenuOpen = open[1];
			return h(primitives.MenuItemButton, {
				danger: true,
				icon: h(primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: function () {
					if (typeof setMenuOpen === "function") setMenuOpen(false);
					dialogStore.set({ kind: "session", sessionId: sessionId, displayTitle: displayTitle || titleOf(sessionId) });
				},
				children: t("menu.deleteSession"),
			});
		}

		/* ── confirmation dialog ───────────────────────────────────────────── */

		function SessionDeleteDialog() {
			var request = useStore(dialogStore);
			if (!request) return null;
			if (request.kind === "workspace") {
				return h(WorkspaceDeleteDialog, { key: "workspace:" + request.workspaceId, request: request });
			}
			return h(DeleteConfirm, { key: request.sessionId, request: request });
		}

		/** Open the workspace batch-delete dialog. Public for programmatic use. */
		function openWorkspaceDelete(workspaceId, title) {
			if (typeof workspaceId !== "string" || workspaceId.length === 0) return;
			var previous = workspaceJobStore.get();
			if (previous && previous.state !== "running") workspaceJobStore.set(null);
			dialogStore.set({
				kind: "workspace",
				workspaceId: workspaceId,
				title: title || workspaceTitle(workspaceId),
			});
		}

		function infoRow(label, value, key) {
			return h("div", { className: "session-delete-row", key: key }, [
				h("span", { className: "session-delete-key", key: "k" }, label),
				h("span", { className: "session-delete-value", key: "v" }, value),
			]);
		}

		/**
		 * The host answers a refusal with the whole pipeline report (`value`), so a
		 * failed or partial delete can name the failing stage and any file it could
		 * not remove instead of showing a bare HTTP status.
		 */
		function buildFailureDetail(report) {
			if (!report || typeof report !== "object") return [];
			var rows = [];
			var stages = Array.isArray(report.stages) ? report.stages : [];
			stages.forEach(function (stage) {
				if (!stage || (stage.status !== "failed" && stage.status !== "blocked")) return;
				rows.push(
					h("div", { className: "session-delete-row", key: "stage-" + String(stage.key) }, [
						h("span", { className: "session-delete-key", key: "k" }, String(stage.key)),
						h(
							"span",
							{ className: "session-delete-value", key: "v" },
							String(stage.status) + (stage.detail ? " · " + stage.detail : "")
						),
					])
				);
			});
			var leftovers = Array.isArray(report.leftoverDiskPaths) ? report.leftoverDiskPaths : [];
			leftovers.forEach(function (path, index) {
				rows.push(
					h("div", { className: "session-delete-row", key: "leftover-" + index }, [
						h("span", { className: "session-delete-key", key: "k" }, t("dialog.leftover")),
						h("span", { className: "session-delete-value", key: "v" }, String(path)),
					])
				);
			});
			if (rows.length === 0) return [];
			rows.unshift(h("div", { className: "session-delete-key", key: "title" }, t("dialog.report")));
			return rows;
		}

		function DeleteConfirm(props) {
			var request = props.request;
			var phasePair = react.useState("loading");
			var phase = phasePair[0];
			var setPhase = phasePair[1];
			var previewPair = react.useState(null);
			var preview = previewPair[0];
			var setPreview = previewPair[1];
			var errorPair = react.useState(null);
			var error = errorPair[0];
			var setError = errorPair[1];
			var forcedPair = react.useState(false);
			var forced = forcedPair[0];
			var setForced = forcedPair[1];
			var reportPair = react.useState(null);
			var report = reportPair[0];
			var setReport = reportPair[1];
			// Synchronous in-flight flag: the button's `disabled` only lands after
			// the store-driven re-render, so a fast double click could otherwise
			// fire two deletes.
			var inFlight = react.useRef(false);

			react.useEffect(function () {
				var alive = true;
				callHost("/session-delete/preview", { sessionId: request.sessionId })
					.then(function (value) {
						if (!alive) return;
						setPreview(value);
						setPhase("ready");
					})
					.catch(function (reason) {
						if (!alive) return;
						setError(messageOf(reason));
						setPhase("ready");
					});
				return function () {
					alive = false;
				};
			}, [request.sessionId]);

			var activity = preview && Array.isArray(preview.activity) ? preview.activity : [];
			var busy = activity.length > 0;
			var force = busy || forced;
			var deleting = phase === "deleting";

			/**
			 * Closing is always allowed, including while the request is in flight:
			 * the host keeps working and the outcome still lands as a toast. A
			 * disabled close is what turns an unresponsive host into a stuck modal.
			 */
			function close() {
				dialogStore.set(null);
			}

			function confirm() {
				var sessionId = request.sessionId;
				if (inFlight.current || deletingIds[sessionId] === true) return;
				inFlight.current = true;
				deletingIds[sessionId] = true;
				setPhase("deleting");
				setError(null);
				setReport(null);
				callHost("/session-delete/delete", { sessionId: sessionId, force: force })
					.then(function () {
						delete deletingIds[sessionId];
						dialogStore.set(null);
						showToast(t("toast.deleted"), "success");
						refreshSessions();
					})
					.catch(function (reason) {
						delete deletingIds[sessionId];
						inFlight.current = false;
						setPhase("ready");
						var message = messageOf(reason);
						setError(message);
						setReport(reason && reason.report ? reason.report : null);
						setForced(true);
						showToast(t("toast.failed", { message: message }), "error");
					});
			}

			var body = [];
			body.push(h("ul", { className: "session-delete-list", key: "list" }, [
				infoRow(t("dialog.session"), request.displayTitle || request.sessionId, "session"),
				preview && preview.cwd ? infoRow(t("dialog.location"), String(preview.cwd), "cwd") : null,
				infoRow(
					t("dialog.disk"),
					preview
						? (preview.totalFiles > 0
							? t("dialog.files", { files: preview.totalFiles, size: humanBytes(preview.totalBytes) })
							: t("dialog.noLogs"))
						: t("dialog.loading"),
					"disk"
				),
				infoRow(
					t("dialog.workspace"),
					preview && Array.isArray(preview.workspaces) && preview.workspaces.length > 0
						? preview.workspaces.map(function (workspace) {
							return workspace.title || workspace.path || workspace.workspaceId;
						}).join("、")
						: t("dialog.none"),
					"workspaces"
				),
				infoRow(
					t("dialog.state"),
					preview
						? [
							busy ? t("dialog.busy", { n: activity.length }) : t("dialog.idle"),
							preview.archived ? t("dialog.archived") : null,
							preview.pinned ? t("dialog.pinned") : null,
						].filter(Boolean).join(" · ")
						: t("dialog.loading"),
					"state"
				),
			]));
			if (busy) body.push(h("div", { className: "session-delete-warn", key: "warn", role: "alert" }, t("dialog.busy", { n: activity.length })));
			var lockedDirs = preview && Array.isArray(preview.dirs)
				? preview.dirs.filter(function (dir) {
					return dir && dir.locked === true;
				})
				: [];
			if (lockedDirs.length > 0) {
				body.push(h("div", { className: "session-delete-warn", key: "locked" }, t("dialog.locked")));
			}
			// Storage relocated to another volume behind a directory link: say so,
			// because the delete follows the link and clears the real directory.
			var linkedDirs = preview && Array.isArray(preview.dirs)
				? preview.dirs.filter(function (dir) {
					return dir && dir.link === true;
				})
				: [];
			if (linkedDirs.length > 0) {
				var linkedTargets = linkedDirs.map(function (dir) {
					return dir.target || dir.path;
				}).join("\n");
				body.push(h("div", { className: "session-delete-note", key: "linked", title: linkedTargets }, t("dialog.linked")));
			}
			if (preview && preview.forceAllowed === false) {
				body.push(h("div", { className: "session-delete-warn", key: "force-off" }, t("dialog.forceDisabled")));
			}
			if (deleting) body.push(h("div", { className: "session-delete-status", key: "status", role: "status" }, t("dialog.deleting")));
			if (error) body.push(h("div", { className: "session-delete-error", key: "error", role: "alert" }, error));
			if (error) {
				var failureDetail = buildFailureDetail(report);
				if (failureDetail.length > 0) {
					body.push(h("div", { className: "session-delete-detail", key: "report" }, failureDetail));
				}
			}

			var footer = [
				h(primitives.Button, {
					key: "cancel",
					variant: "outline",
					"data-modal-autofocus": true,
					onClick: close,
					children: deleting ? t("close") : t("dialog.cancel"),
				}),
				h(primitives.Button, {
					key: "confirm",
					variant: "outline",
					className: "session-delete-confirm",
					disabled: deleting || phase === "loading",
					onClick: confirm,
					children: force ? t("dialog.forceDelete") : t("dialog.delete"),
				}),
			];

			return h(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("close"),
				title: t("dialog.title"),
				description: t("dialog.desc"),
				footer: footer,
				children: body,
			});
		}

		/* ── workspace batch delete ────────────────────────────────────────── */

		function jobFailedCount(job) {
			return job && Array.isArray(job.failed) ? job.failed.length : 0;
		}

		/**
		 * Poll `workspace/status` outside React so closing (or unmounting) the
		 * dialog never abandons the job: the final snapshot still lands in the
		 * store and the toast still fires.
		 */
		function startWorkspaceJobPoll(jobId) {
			if (typeof jobId !== "string" || jobId.length === 0) return;
			if (activeJobPoll && activeJobPoll.jobId === jobId) return;
			if (activeJobPoll && activeJobPoll.timer) clearTimeout(activeJobPoll.timer);
			var handle = { jobId: jobId, timer: 0, stopped: false };
			activeJobPoll = handle;
			function tick() {
				if (handle.stopped || activeJobPoll !== handle) return;
				callHost("/session-delete/workspace/status", { jobId: jobId })
					.then(function (status) {
						if (handle.stopped || activeJobPoll !== handle) return;
						workspaceJobStore.set(status);
						if (status && status.state === "running") {
							handle.timer = setTimeout(tick, 500);
							return;
						}
						activeJobPoll = null;
						workspaceJobFinished(status);
					})
					.catch(function (reason) {
						if (handle.stopped || activeJobPoll !== handle) return;
						activeJobPoll = null;
						workspaceJobStore.set(null);
						showToast(t("toast.failed", { message: messageOf(reason) }), "error");
					});
			}
			handle.timer = setTimeout(tick, 400);
		}

		function workspaceJobFinished(status) {
			refreshSessions();
			var deleted = Number(status && status.deleted) || 0;
			var total = Number(status && status.total) || 0;
			var failed = jobFailedCount(status);
			if (failed === 0 && status && status.state === "done") {
				showToast(t("workspace.toast.deleted", { n: deleted }), "success");
				var current = dialogStore.get();
				if (current && current.kind === "workspace" && current.workspaceId === status.workspaceId) {
					dialogStore.set(null);
				}
				return;
			}
			if (failed > 0) {
				showToast(t("workspace.toast.partial", { done: deleted, total: total, failed: failed }), "error");
			} else {
				showToast(
					t("toast.failed", {
						message: status && status.error
							? String(status.error)
							: t("workspace.toast.partial", { done: deleted, total: total, failed: failed }),
					}),
					"error"
				);
			}
		}

		function pushFailedRow(rows, failure, index) {
			var sessionId = failure && failure.sessionId ? String(failure.sessionId) : "?";
			var message = failure && failure.message ? String(failure.message) : "";
			rows.push(h("div", { className: "session-delete-row", key: "failure-" + index }, [
				h("span", { className: "session-delete-key", key: "k" }, sessionId),
				h("span", { className: "session-delete-value", key: "v" }, message),
			]));
		}

		function WorkspaceDeleteDialog(props) {
			var request = props.request;
			var previewPair = react.useState(null);
			var preview = previewPair[0];
			var setPreview = previewPair[1];
			var phasePair = react.useState("loading");
			var phase = phasePair[0];
			var setPhase = phasePair[1];
			var errorPair = react.useState(null);
			var error = errorPair[0];
			var setError = errorPair[1];
			var reloadPair = react.useState(0);
			var reload = reloadPair[0];
			var setReload = reloadPair[1];
			var inFlight = react.useRef(false);
			var job = useStore(workspaceJobStore);
			var activeJob = job && job.workspaceId === request.workspaceId ? job : null;
			var deleting = phase === "deleting" || (activeJob !== null && activeJob.state === "running");

			react.useEffect(function () {
				var alive = true;
				var current = workspaceJobStore.get();
				if (current && current.workspaceId === request.workspaceId && current.state === "running") {
					setPhase("deleting");
					return function () {
						alive = false;
					};
				}
				setPhase("loading");
				setPreview(null);
				setError(null);
				callHost("/session-delete/workspace/preview", { workspaceId: request.workspaceId })
					.then(function (value) {
						if (!alive) return;
						setPreview(value);
						setPhase("ready");
					})
					.catch(function (reason) {
						if (!alive) return;
						setError(messageOf(reason));
						setPhase("ready");
					});
				return function () {
					alive = false;
				};
			}, [request.workspaceId, reload]);

			var count = preview ? Number(preview.count) || 0 : 0;
			var running = preview ? Number(preview.runningCount) || 0 : 0;
			var busy = running > 0;
			var forceAllowed = preview ? preview.forceAllowed !== false : true;
			var force = busy;
			var finalJob = activeJob && activeJob.state !== "running" ? activeJob : null;

			/**
			 * Closing stays possible while the job runs: the host keeps working,
			 * the toast reports the outcome, and reopening shows the progress.
			 */
			function close() {
				dialogStore.set(null);
			}

			function retry() {
				workspaceJobStore.set(null);
				inFlight.current = false;
				setReload(reload + 1);
			}

			function confirm() {
				if (inFlight.current || deleting) return;
				if (!preview || count === 0) return;
				if (busy && !forceAllowed) return;
				inFlight.current = true;
				setError(null);
				setPhase("deleting");
				callHost("/session-delete/workspace/delete", { workspaceId: request.workspaceId, force: force })
					.then(function (value) {
						workspaceJobStore.set({
							jobId: value.jobId,
							workspaceId: request.workspaceId,
							state: "running",
							total: value.total,
							completed: 0,
							deleted: 0,
							failed: [],
						});
						startWorkspaceJobPoll(value.jobId);
					})
					.catch(function (reason) {
						inFlight.current = false;
						setPhase("ready");
						var message = messageOf(reason);
						setError(message);
						showToast(t("toast.failed", { message: message }), "error");
					});
			}

			var rows = [];
			rows.push(infoRow(t("workspace.dialog.workspace"), request.title || workspaceTitle(request.workspaceId), "workspace"));
			if (preview && preview.path) rows.push(infoRow(t("workspace.dialog.path"), String(preview.path), "path"));
			rows.push(infoRow(
				t("workspace.dialog.sessions"),
				preview ? t("workspace.dialog.sessionsValue", { n: count }) : t("workspace.dialog.loading"),
				"sessions"
			));
			if (busy) {
				rows.push(infoRow(t("workspace.dialog.running"), t("workspace.dialog.runningValue", { n: running }), "running"));
			}
			rows.push(infoRow(
				t("workspace.dialog.disk"),
				preview
					? (preview.totalFiles > 0
						? t("dialog.files", { files: preview.totalFiles, size: humanBytes(preview.totalBytes) })
						: t("dialog.noLogs"))
					: t("workspace.dialog.loading"),
				"disk"
			));
			if (preview && Number(preview.archivedCount) > 0) {
				rows.push(infoRow(t("workspace.dialog.archived"), String(preview.archivedCount), "archived"));
			}

			var body = [h("ul", { className: "session-delete-list", key: "list" }, rows)];
			if (preview && count === 0) {
				body.push(h("div", { className: "session-delete-note", key: "empty" }, t("workspace.dialog.empty")));
			}
			if (busy) {
				body.push(h("div", { className: "session-delete-warn", key: "busy", role: "alert" }, t("workspace.dialog.runningHint", { n: running })));
			}
			if (busy && !forceAllowed) {
				body.push(h("div", { className: "session-delete-warn", key: "force-off" }, t("dialog.forceDisabled")));
			}
			if (deleting) {
				body.push(h("div", { className: "session-delete-status", key: "status", role: "status" }, t("workspace.dialog.progress", {
					done: activeJob ? Number(activeJob.completed) || 0 : 0,
					total: activeJob ? Number(activeJob.total) || count : count,
				})));
			}
			if (finalJob) {
				var failureCount = jobFailedCount(finalJob);
				body.push(h("div", { className: "session-delete-status", key: "summary", role: "status" }, t("workspace.dialog.progressFailed", {
					done: Number(finalJob.deleted) || 0,
					total: Number(finalJob.total) || 0,
					failed: failureCount,
				})));
				if (failureCount > 0) {
					var failures = [];
					for (var failureIndex = 0; failureIndex < finalJob.failed.length; failureIndex += 1) {
						pushFailedRow(failures, finalJob.failed[failureIndex], failureIndex);
					}
					body.push(h("div", { className: "session-delete-detail", key: "report" }, [
						h("div", { className: "session-delete-key", key: "title" }, t("workspace.dialog.report")),
					].concat(failures)));
				}
			}
			if (error) {
				body.push(h("div", { className: "session-delete-error", key: "error", role: "alert" }, error));
			}

			var footer = [
				h(primitives.Button, {
					key: "cancel",
					variant: "outline",
					"data-modal-autofocus": true,
					onClick: close,
					children: deleting ? t("close") : t("dialog.cancel"),
				}),
			];
			if (finalJob) {
				footer.push(h(primitives.Button, {
					key: "retry",
					variant: "outline",
					onClick: retry,
					children: t("workspace.dialog.retry"),
				}));
			} else if (!deleting) {
				footer.push(h(primitives.Button, {
					key: "confirm",
					variant: "outline",
					className: "session-delete-confirm",
					disabled: phase === "loading" || count === 0 || (busy && !forceAllowed),
					onClick: confirm,
					children: force ? t("workspace.dialog.forceDelete") : t("workspace.dialog.delete"),
				}));
			}

			return h(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("close"),
				title: t("workspace.dialog.title"),
				description: t("workspace.dialog.desc"),
				footer: footer,
				children: body,
			});
		}

		/* ── workspace row "..." menu augmentation ─────────────────────────── */

		/**
		 * DSH 0.2.0-rc.2 renders the workspace row menu from a hardcoded
		 * `workspaceMenuItems` array and exposes no slot for it, so the extra
		 * destructive row is added to the already-rendered menu list. Nothing is
		 * observed globally: a click inside a workspace row arms one short rAF
		 * poll that waits for the portal menu, copies the existing danger row and
		 * rewires it. Every step is guarded, so a future DSH DOM change costs the
		 * extra row and nothing else.
		 */

		function raf(callback) {
			if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
			return setTimeout(callback, 16);
		}

		function menuNodes() {
			try {
				var nodes = document.querySelectorAll('[role="menu"][data-menu-material]');
				var out = [];
				for (var index = 0; index < nodes.length; index += 1) out.push(nodes[index]);
				return out;
			} catch (error) {
				return [];
			}
		}

		function workspaceRowId(row) {
			var key = row && row.getAttribute ? row.getAttribute("data-row-key") : null;
			if (typeof key !== "string" || key.indexOf("workspace:") !== 0) return null;
			var workspaceId = key.slice("workspace:".length);
			return workspaceId.length > 0 ? workspaceId : null;
		}

		function workspaceRowOf(element) {
			if (!element || typeof element.closest !== "function") return null;
			var row = element.closest('[data-row-key^="workspace:"]');
			return row && workspaceRowId(row) ? row : null;
		}

		/** Which workspace row does the freshly mounted portal menu belong to? */
		function workspaceRowOfMenu(menu) {
			var menuRect = menu.getBoundingClientRect ? menu.getBoundingClientRect() : null;
			if (!menuRect || menuRect.width === 0) return null;
			var focused = document.activeElement;
			var focusedRow = workspaceRowOf(focused);
			if (focusedRow) {
				var rowRect = focusedRow.getBoundingClientRect();
				if (rowRect &&
					menuRect.left >= rowRect.left - 40 && menuRect.left <= rowRect.right + 40 &&
					menuRect.top >= rowRect.top - 280 && menuRect.top <= rowRect.bottom + 280) {
					return focusedRow;
				}
			}
			if (typeof document.elementFromPoint !== "function") return null;
			for (var offset = 2; offset <= 48; offset += 2) {
				var hit = document.elementFromPoint(menuRect.left + 3, menuRect.top - offset);
				var found = workspaceRowOf(hit);
				if (found) return found;
			}
			return null;
		}

		function closeWorkspaceMenu() {
			try {
				if (typeof KeyboardEvent === "function") {
					document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
				}
			} catch (error) {
				/* the menu also closes on the next outside interaction */
			}
		}

		function augmentWorkspaceMenu(menu, row) {
			if (!menu || menu.getAttribute("data-session-delete-menu") === "1") return;
			var workspaceId = workspaceRowId(row);
			if (!workspaceId) return;
			var viewport = null;
			var children = menu.children || [];
			for (var index = 0; index < children.length; index += 1) {
				if (children[index].getAttribute && children[index].getAttribute("role") === "presentation") {
					viewport = children[index];
					break;
				}
			}
			if (!viewport && typeof menu.querySelector === "function") viewport = menu.querySelector('[role="presentation"]');
			if (!viewport || !viewport.children) return;
			var items = [];
			for (var itemIndex = 0; itemIndex < viewport.children.length; itemIndex += 1) {
				var item = viewport.children[itemIndex];
				if (!item.querySelector || !item.querySelector('button[role="menuitem"]')) continue;
				items.push(item);
			}
			if (items.length === 0) return;
			var clone = items[items.length - 1].cloneNode(true);
			var trigger = clone.querySelector('button[role="menuitem"]') || clone.querySelector("button");
			if (!trigger) return;
			var count = workspaceSessionCount(workspaceId);
			var labelText = count === null || count === undefined
				? t("workspace.menu.deleteAll")
				: t("workspace.menu.deleteAllCount", { n: count });
			var spans = trigger.querySelectorAll("span");
			if (spans.length > 0) spans[spans.length - 1].textContent = labelText;
			else trigger.textContent = labelText;
			trigger.removeAttribute("aria-keyshortcuts");
			trigger.setAttribute("data-session-delete-workspace", workspaceId);
			trigger.addEventListener("click", function (event) {
				if (event && typeof event.preventDefault === "function") event.preventDefault();
				if (event && typeof event.stopPropagation === "function") event.stopPropagation();
				if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
				closeWorkspaceMenu();
				var record = workspaceSnapshotItem(workspaceId);
				openWorkspaceDelete(workspaceId, record ? (record.title || record.path) : "");
			});
			viewport.appendChild(clone);
			menu.setAttribute("data-session-delete-menu", "1");
		}

		function installWorkspaceMenuAugmentation() {
			if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") {
				return function () {};
			}
			var handler = function (event) {
				try {
					var target = event && event.target;
					var row = workspaceRowOf(target);
					if (!row) return;
					var button = target && typeof target.closest === "function" ? target.closest("button") : null;
					if (!button || typeof row.contains !== "function" || !row.contains(button)) return;
					var known = menuNodes();
					var frames = 0;
					function tick() {
						frames += 1;
						var menus = menuNodes();
						for (var index = 0; index < menus.length; index += 1) {
							if (known.indexOf(menus[index]) !== -1) continue;
							if (menus[index].isConnected === false) continue;
							var found = workspaceRowOfMenu(menus[index]);
							if (!found) continue;
							augmentWorkspaceMenu(menus[index], found);
							return;
						}
						if (frames < 90) raf(tick);
					}
					raf(tick);
				} catch (error) {
					/* a future DSH DOM change only costs the extra menu row */
				}
			};
			document.addEventListener("click", handler, true);
			return function () {
				try {
					document.removeEventListener("click", handler, true);
				} catch (error) {
					/* already detached */
				}
			};
		}

		/* ── notice ────────────────────────────────────────────────────────── */

		function SessionDeleteToast() {
			var toast = useStore(toastStore);
			if (!toast) return null;
			var tone = toast.tone === "error" ? "error" : "success";
			return h(
				"div",
				{
					className: "session-delete-toast session-delete-toast-" + tone,
					role: tone === "error" ? "alert" : "status",
				},
				toast.text
			);
		}

		/* ── plugin entry ──────────────────────────────────────────────────── */

		var inject = ["slots", "locale", "sessions"];

		function apply(ctx) {
			runtime.ctx = ctx;
			try {
				runtime.t = ctx.locale.bind(NS);
			} catch (error) {
				runtime.t = null;
			}

			ctx.effect(function () {
				return ctx.locale.register(NS, DICT);
			}, NS + ": dictionaries");

			ctx.effect(function () {
				var tag = document.createElement("style");
				tag.dataset.sessionDeleteCss = "1";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return function () {
					tag.remove();
				};
			}, NS + ": styles");

			// The workspace row menu is rendered from a hardcoded array (no slot in
			// DSH 0.2.0-rc.2), so the extra destructive row is added by observing
			// clicks inside workspace rows. No global MutationObserver is kept.
			ctx.effect(function () {
				return installWorkspaceMenuAugmentation();
			}, NS + ": workspace-menu");

			var disposeMenu = ctx.slots.inject(MENU_SLOT, function () {
				return ctx.slots.register(
					{
						name: MENU_SLOT,
						id: NS + ".menu-item",
						order: MENU_ORDER,
						locale: NS,
						label: function () {
							return t("menu.deleteSession");
						},
					},
					function (props) {
						return DeleteSessionMenuItem(props);
					}
				);
			});

			var disposeDialog = ctx.slots.inject(OVERLAY_SLOT, function () {
				return ctx.slots.register(
					{ name: OVERLAY_SLOT, id: NS + ".dialog", order: 900, locale: NS },
					function () {
						return SessionDeleteDialog();
					}
				);
			});

			var disposeToast = ctx.slots.inject(OVERLAY_SLOT, function () {
				return ctx.slots.register(
					{ name: OVERLAY_SLOT, id: NS + ".toast", order: 950, locale: NS },
					function () {
						return SessionDeleteToast();
					}
				);
			});

			// The slot injections are disposed by this effect, but cordis may also
			// dispose them with the plugin's own scope: run each disposer at most
			// once and never let a "already disposed" throw escape the unload path.
			var slotsDisposed = false;
			ctx.effect(function () {
				return function () {
					if (slotsDisposed) return;
					slotsDisposed = true;
					var disposers = [disposeMenu, disposeDialog, disposeToast];
					for (var index = 0; index < disposers.length; index += 1) {
						try {
							if (typeof disposers[index] === "function") disposers[index]();
						} catch (error) {
							/* already disposed by the plugin scope */
						}
					}
				};
			}, NS + ": slots");

			try {
				console.info("[session-delete] client " + VERSION + " mounted");
			} catch (error) {
				/* console may be muted */
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.openWorkspaceDelete = openWorkspaceDelete;
		return module.exports;
	},
});
