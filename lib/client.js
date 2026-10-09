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
		var VERSION = "0.1.0";
		var MENU_SLOT = "sidebar.workspaces.session.menu.item";
		var OVERLAY_SLOT = "shell.overlay";
		/** After pin(100) / rename(200) / fork(300) / archive(400): last, and destructive. */
		var MENU_ORDER = 500;

		var DICT = {
			zh: {
				"menu.deleteSession": "删除会话",
				"actions.delete": "删除会话",
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
					dialogStore.set({ sessionId: sessionId, displayTitle: displayTitle || titleOf(sessionId) });
				},
				children: t("menu.deleteSession"),
			});
		}

		/* ── confirmation dialog ───────────────────────────────────────────── */

		function SessionDeleteDialog() {
			var request = useStore(dialogStore);
			if (!request) return null;
			return h(DeleteConfirm, { key: request.sessionId, request: request });
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
		return module.exports;
	},
});
