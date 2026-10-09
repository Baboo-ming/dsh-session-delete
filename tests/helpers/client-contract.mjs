/**
 * Shared client-contract constants for the test suite.
 *
 * `lib/client.js` is a browser bundle (it calls `window.__ModuleLoader__.load`
 * at import time), so it cannot be imported as an ES module. These constants
 * mirror its module-level values and `tests/client-bundle.test.js` asserts the
 * bundle source still contains them, so drift fails the suite instead of
 * silently testing the wrong slot.
 */

/** Locale namespace / slot-id prefix. */
export const NS = 'session-delete'

/** Sidebar session row `...` menu slot. */
export const MENU_SLOT = 'sidebar.workspaces.session.menu.item'

/** Global overlay slot used for the confirm dialog and the notice. */
export const OVERLAY_SLOT = 'shell.overlay'

/** After pin(100) / rename(200) / fork(300) / archive(400). */
export const MENU_ORDER = 500
