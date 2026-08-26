# Phase 3 Formal Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-size configuration popup with the approved resizable formal workspace and implement prompt/command management, daily schedule management, and the unified settings page shown in `phase3-review/`.

**Architecture:** Keep the transparent pet/chat window isolated in the existing `index.html` renderer and open a second, opaque `workspace.html` BrowserWindow for all management features. Put schema migration and data mutations in testable CommonJS main-process modules, keep view derivation in pure browser-compatible `.mjs` modules, and expose only explicit IPC methods through a dedicated `workspace-preload.js` bridge.

**Tech Stack:** Electron 31, Node.js built-ins, electron-store 8, native HTML/CSS/JavaScript, Node `node:test`, Electron offscreen `capturePage`; no new runtime or development dependencies.

**Spec:** `phase3-review/三期需求头脑风暴与产品方案.md`

## Global Constraints

- Execute P3-M0 through P3-M7 sequentially; finish verification and update `开发日志/开发日志.md` before starting the next milestone.
- The formal workspace defaults to 1180×760 and must not resize below 960×640.
- The only top-level navigation labels, in order, are `提示词管理工具`, `日程管理`, and `设置`.
- Keep `contextIsolation: true` and `nodeIntegration: false` in both BrowserWindows.
- Render user-controlled titles, content, notes, and reminder text with `textContent`; do not concatenate them into HTML strings.
- API keys remain in the main process/electron-store/.env and are never returned to either renderer.
- Commands are text records that can only be copied; do not add process execution, shell execution, or file execution.
- Cover imports accept local PNG/JPEG/WebP files up to 10 MiB and copy them into `userData/prompt-covers/`; remote image URLs are out of scope.
- Preserve all legacy reminders and migrate legacy commands non-destructively into the default `常用命令` space.
- Reuse the approved `phase3-review/` layout and the existing `assets/ui-theme/firefly/` theme; do not reference `diamond-mark`.
- Update `package.json` and `scripts/dist-temp.ps1` so every new production file is packaged and the asar whitelist check remains strict.

---

## Planned File Structure

```text
main.js                         existing pet lifecycle, scheduler, IPC composition
main/
├─ workspace-schema.js         schema v3 normalization and pure migration
├─ workspace-repository.js     atomic space/entry/task/reminder mutations
├─ workspace-window.js         formal BrowserWindow lifecycle and bounds persistence
└─ prompt-covers.js            safe local cover import, protocol serving, cleanup
workspace-preload.js           workspace-only IPC whitelist and dropped-file path bridge
workspace.html                 formal application shell and semantic page containers
workspace.css                  production adaptation of the approved prototype
workspace.js                   top-level page routing, state refresh, window controls
renderer/
├─ workspace-model.mjs         pure entry filtering/sorting, board grouping, calendar cells
├─ prompts.mjs                 spaces, cards, forms, drawer and copying
├─ schedule.mjs                board, calendar, reminder list and task forms
├─ settings.mjs                general settings and model configuration form
└─ workspace-ui.mjs            safe DOM builders, modal, toast and date helpers
tests/
├─ workspace-schema.test.js
├─ workspace-repository.test.js
├─ workspace-model.test.mjs
└─ prompt-covers.test.js
scripts/
└─ capture-workspace.js        offscreen UI smoke test and review screenshots
```

The existing `index.html`, `styles.css`, and `renderer.js` continue to own only the pet, chat bubble, and reminder presentation. The old configuration panel is removed from those files only after the new workspace passes all feature checks.

---

### Task 1 — P3-M0: Freeze v3 specifications and implement schema migration primitives

**Files:**
- Modify: `docs/需求规范.md`
- Modify: `docs/技术规范.md`
- Modify: `docs/设计规范.md`
- Modify: `docs/开发步骤.md`
- Modify: `开发日志/开发日志.md`
- Create: `main/workspace-schema.js`
- Create: `tests/workspace-schema.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `SCHEMA_VERSION`, `DEFAULT_SPACE_ID`, `migrateToSchemaV3(snapshot, options)`, `normalizeSpace(value)`, `normalizeEntry(value, fallbackSpaceId)`, `normalizeTask(value)`, and `localDateKey(date)`.
- `migrateToSchemaV3` returns `{ data, changed, backup }`; `backup` is non-null only when a pre-v3 snapshot was transformed.
- Later repository and scheduler tasks consume the exact normalized field names defined here.

- [ ] **Step 1: Update the formal specifications before implementation**

Record version 3 requirements in the four formal docs. Use these exact milestone names in `docs/开发步骤.md`:

```markdown
P3-M0 规范与 schema v3
P3-M1 正式工作台窗口与应用壳层
P3-M2 项目空间与统一内容模型
P3-M3 封面和详情抽屉
P3-M4 每日三列任务看板
P3-M5 月历、提醒管理与任务提醒关联
P3-M6 完整设置页与密钥安全收口
P3-M7 响应式、多屏、打包与总验收
```

Change the current development-log milestone to `P3-M0 规范与 schema v3` and note that `phase3-review/` is the approved visual source.

- [ ] **Step 2: Add the schema test command**

Add these scripts to `package.json` without changing the existing commands:

```json
"test:workspace": "node --test tests/workspace-schema.test.js tests/workspace-repository.test.js tests/workspace-model.test.mjs",
"test": "npm run test:chat && npm run test:workspace"
```

Create temporary empty repository/model test files only when Node requires all listed paths to exist; each must contain a passing `node:test` smoke assertion until its owning task replaces it.

- [ ] **Step 3: Write failing migration tests**

Create `tests/workspace-schema.test.js` with a deterministic clock and representative legacy data:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION,
  DEFAULT_SPACE_ID,
  migrateToSchemaV3,
  normalizeTask,
  localDateKey
} = require('../main/workspace-schema');

test('migrates legacy commands without changing reminders or chat settings', () => {
  const snapshot = {
    commands: [{ id: 'c1', title: '启动', content: 'npm start', pinned: true }],
    reminders: [{ id: 'r1', type: 'interval', intervalMin: 60, text: '休息', enabled: true }],
    settings: { volume: 0.6, chat: { apiKey: 'secret', model: 'deepseek-chat' } }
  };
  const result = migrateToSchemaV3(snapshot, { now: 1787702400000 });
  assert.equal(result.data.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(result.data.spaces.map(({ id, name, order }) => ({ id, name, order })), [
    { id: DEFAULT_SPACE_ID, name: '常用命令', order: 0 }
  ]);
  assert.deepEqual(result.data.entries[0], {
    id: 'c1', spaceId: DEFAULT_SPACE_ID, type: 'command', title: '启动',
    content: 'npm start', coverId: null, pinned: true, favorite: false,
    createdAt: 1787702400000, updatedAt: 1787702400000
  });
  assert.deepEqual(result.data.reminders, snapshot.reminders);
  assert.equal(result.data.settings.chat.apiKey, 'secret');
  assert.equal(result.backup.commands[0].id, 'c1');
});

test('normalizes task enums and uses local calendar dates', () => {
  assert.deepEqual(normalizeTask({ id: 't1', title: '评审', date: '2026-08-26' }), {
    id: 't1', title: '评审', date: '2026-08-26', time: '', status: 'todo',
    priority: 'normal', notes: '', reminderId: null, createdAt: 0, updatedAt: 0
  });
  assert.equal(localDateKey(new Date(2026, 7, 26, 23, 0, 0)), '2026-08-26');
});
```

- [ ] **Step 4: Run the tests and confirm the missing-module failure**

Run: `node --test tests/workspace-schema.test.js`

Expected: FAIL because `main/workspace-schema.js` does not exist.

- [ ] **Step 5: Implement the smallest complete schema module**

Implement strict array/object guards, enum allowlists, string length clamps, and legacy `quick → pinned` support. Use this public shape:

```js
const SCHEMA_VERSION = 3;
const DEFAULT_SPACE_ID = 'space-commands';
const ENTRY_TYPES = new Set(['prompt', 'command']);
const TASK_STATUSES = new Set(['todo', 'doing', 'done']);
const TASK_PRIORITIES = new Set(['low', 'normal', 'high']);

function migrateToSchemaV3(snapshot, { now = Date.now() } = {}) {
  const source = snapshot && typeof snapshot === 'object' ? structuredClone(snapshot) : {};
  if (source.schemaVersion === SCHEMA_VERSION) {
    return { data: normalizeSchemaV3(source), changed: false, backup: null };
  }
  const backup = structuredClone(source);
  const spaces = [{ id: DEFAULT_SPACE_ID, name: '常用命令', order: 0, createdAt: now }];
  const entries = (Array.isArray(source.commands) ? source.commands : []).map((command) =>
    normalizeEntry({ ...command, spaceId: DEFAULT_SPACE_ID, type: 'command', createdAt: command.createdAt || now, updatedAt: command.updatedAt || now }, DEFAULT_SPACE_ID)
  );
  return {
    changed: true,
    backup,
    data: normalizeSchemaV3({ ...source, schemaVersion: SCHEMA_VERSION, spaces, entries, tasks: [], reminders: source.reminders || [], settings: source.settings || {} })
  };
}
```

Use `String(value ?? '').trim()` for titles, preserve newlines in content/notes, and never delete legacy fields inside the pure migration result until the repository has written the backup.

- [ ] **Step 6: Run schema and existing chat tests**

Run: `node --test tests/workspace-schema.test.js`

Expected: all schema tests PASS.

Run: `npm run test:chat`

Expected: all existing chat tests PASS.

- [ ] **Step 7: Update the log and commit P3-M0**

Record test counts and migration decisions in `开发日志/开发日志.md`.

```bash
git add docs/需求规范.md docs/技术规范.md docs/设计规范.md docs/开发步骤.md 开发日志/开发日志.md package.json main/workspace-schema.js tests/workspace-schema.test.js tests/workspace-repository.test.js tests/workspace-model.test.mjs
git commit -m "docs: define phase three workspace schema"
```

---

### Task 2 — P3-M0: Add the atomic workspace repository

**Files:**
- Create: `main/workspace-repository.js`
- Replace smoke content: `tests/workspace-repository.test.js`
- Modify: `main.js`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Consumes: schema functions from Task 1 and an electron-store-compatible `{ get(key), set(key, value) }` object.
- Produces: `WorkspaceRepository` with `ensureMigrated`, `getState`, space/entry/task methods, `saveReminder`, and `removeReminder`.
- `getState()` returns cloned arrays and settings; main.js removes secret chat fields before IPC serialization.

- [ ] **Step 1: Write repository migration and CRUD tests**

Use this in-memory store helper inside the test file:

```js
class MemoryStore {
  constructor(value = {}) { this.value = structuredClone(value); }
  get(key) { return key.split('.').reduce((current, part) => current?.[part], this.value); }
  set(key, value) {
    const parts = key.split('.');
    let current = this.value;
    while (parts.length > 1) current = current[parts.shift()] ??= {};
    current[parts[0]] = structuredClone(value);
  }
}
```

Cover these cases with explicit assertions:

```js
test('ensureMigrated writes backup before schema version', () => { /* assert backup.schemaVersion and entries */ });
test('rejects duplicate normalized space names', () => { /* 常用命令 and 常用命令 with spaces */ });
test('deletes non-empty space only with migrate or delete disposition', () => { /* assert throw, move, delete */ });
test('entry CRUD preserves one owning space and timestamps', () => { /* add/update/remove */ });
test('task reminder mutation commits both arrays together', () => { /* add task with reminder */ });
test('removing reminder unlinks task without removing it', () => { /* removeReminder */ });
```

- [ ] **Step 2: Run the repository tests and confirm failure**

Run: `node --test tests/workspace-repository.test.js`

Expected: FAIL because `WorkspaceRepository` is missing.

- [ ] **Step 3: Implement constructor, migration, cloning, and validation**

Use dependency injection so tests do not import Electron:

```js
class WorkspaceRepository {
  constructor(store, { clock = Date.now, idFactory = (prefix) => `${prefix}-${crypto.randomUUID()}` } = {}) {
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  ensureMigrated() {
    const snapshot = this.#snapshot();
    const result = migrateToSchemaV3(snapshot, { now: this.clock() });
    if (!result.changed) return result.data;
    this.store.set('schemaV2Backup', result.backup);
    this.#writeState(result.data);
    this.store.set('schemaVersion', SCHEMA_VERSION);
    return result.data;
  }
}
```

Write arrays before `schemaVersion`; if an array write throws, leave the old schema version and backup intact.

- [ ] **Step 4: Implement explicit mutations**

Use these exact signatures:

```js
addSpace({ name })
updateSpace({ id, name })
reorderSpaces(orderedIds)
deleteSpace(id, { mode, targetSpaceId = null })
addEntry({ spaceId, type, title, content, coverId = null, pinned = false, favorite = false })
updateEntry(entry)
removeEntry(id)
addTask(task, { createReminder = false })
updateTask(task, { syncReminder = false })
removeTask(id, { removeReminder = false })
saveReminder(reminder)
removeReminder(id)
```

Validate IDs against the current arrays, reject duplicate space names case-insensitively, clamp entry content to 20,000 characters and task notes to 4,000, and always update timestamps via `clock()`.

- [ ] **Step 5: Run all workspace data tests**

Run: `npm run test:workspace`

Expected: schema and repository tests PASS; the model smoke file also PASS.

- [ ] **Step 6: Integrate repository construction without switching UI yet**

In `main.js`, instantiate after electron-store creation:

```js
const { WorkspaceRepository } = require('./main/workspace-repository');
const workspaceRepository = new WorkspaceRepository(store);
```

Call `workspaceRepository.ensureMigrated()` inside `app.whenReady()` before `seedPresets()`. Keep legacy `commands` during this version for rollback; the repository reads `entries` after migration.

- [ ] **Step 7: Verify startup and commit repository support**

Run: `node --check main.js main/workspace-schema.js main/workspace-repository.js`

Run: `npm test`

Run: `npm start`

Expected: the current pet and old configuration window still open; no user-facing change yet; no migration exception appears.

```bash
git add main.js main/workspace-repository.js tests/workspace-repository.test.js 开发日志/开发日志.md
git commit -m "feat: add phase three workspace repository"
```

---

### Task 3 — P3-M1: Create the formal workspace BrowserWindow and three-page shell

**Files:**
- Create: `main/workspace-window.js`
- Create: `workspace-preload.js`
- Create: `workspace.html`
- Create: `workspace.css`
- Create: `workspace.js`
- Create: `renderer/workspace-ui.mjs`
- Create: `renderer/workspace-model.mjs`
- Replace smoke content: `tests/workspace-model.test.mjs`
- Create: `scripts/capture-workspace.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `package.json`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Produces: `createWorkspaceWindowController(options)` with `open`, `close`, `minimize`, `toggleMaximize`, `applyAlwaysOnTop`, `moveTop`, `getWindow`.
- Produces renderer global `window.workspaceAPI` with `getState`, `windowAction`, `setLastPage`, `copyText`, `onDataChanged`.
- Produces pure helpers `filterAndSortEntries`, `groupTasksByStatus`, `buildMonthCells` as initially failing stubs completed in later tasks.

- [ ] **Step 1: Write static window-contract and renderer-model tests**

Add tests asserting `main/workspace-window.js` exports a factory and that the controller creates this option set through a fake BrowserWindow:

```js
assert.equal(options.width, 1180);
assert.equal(options.height, 760);
assert.equal(options.minWidth, 960);
assert.equal(options.minHeight, 640);
assert.equal(options.frame, false);
assert.equal(options.transparent, false);
assert.equal(options.resizable, true);
assert.equal(options.skipTaskbar, false);
assert.equal(options.webPreferences.contextIsolation, true);
assert.equal(options.webPreferences.nodeIntegration, false);
```

Add model exports with tests that currently fail until the file exists:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortEntries } from '../renderer/workspace-model.mjs';

test('filterAndSortEntries returns a new array', () => {
  const entries = [{ id: '1', type: 'command', title: 'Git', content: 'git status', pinned: false }];
  const result = filterAndSortEntries(entries, { query: '', type: 'all', sort: 'pinned' });
  assert.notEqual(result, entries);
  assert.equal(result[0].id, '1');
});
```

- [ ] **Step 2: Run tests and confirm missing modules**

Run: `npm run test:workspace`

Expected: FAIL on the new window/model imports.

- [ ] **Step 3: Implement `main/workspace-window.js`**

Use constructor injection for `BrowserWindow`, `screen`, paths, settings, and callbacks. Restore only bounds whose rectangle intersects a current display work area by at least 160×120 pixels; otherwise center 1180×760 on the display nearest the cursor. Persist non-maximized bounds and maximized state on close.

```js
const DEFAULT_BOUNDS = { width: 1180, height: 760 };
const MIN_BOUNDS = { width: 960, height: 640 };

function createWorkspaceWindowController({ BrowserWindow, screen, store, preloadPath, htmlPath, isTopEnabled }) {
  let workspaceWin = null;
  return {
    open,
    close: () => workspaceWin?.close(),
    minimize: () => workspaceWin?.minimize(),
    toggleMaximize: () => workspaceWin?.isMaximized() ? workspaceWin.unmaximize() : workspaceWin.maximize(),
    applyAlwaysOnTop: (enabled) => workspaceWin?.setAlwaysOnTop(enabled, enabled ? 'screen-saver' : 'normal'),
    moveTop: () => workspaceWin?.moveTop(),
    getWindow: () => workspaceWin
  };
}
```

- [ ] **Step 4: Create the workspace-only preload**

Expose only these shell methods now; later tasks extend the same object:

```js
contextBridge.exposeInMainWorld('workspaceAPI', {
  getState: () => ipcRenderer.invoke('workspace:get-state'),
  windowAction: (action) => ipcRenderer.invoke('workspace:window-action', action),
  setLastPage: (page) => ipcRenderer.invoke('workspace:set-last-page', page),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', String(text)),
  onDataChanged: (callback) => ipcRenderer.on('workspace:data-changed', () => callback())
});
```

Allow window actions only from `new Set(['minimize', 'toggle-maximize', 'close'])` in main.js.

- [ ] **Step 5: Adapt the approved shell into production files**

Copy the visual tokens, title bar, three top navigation buttons, formal moon-white work area, and responsive dimensions from `phase3-review/界面示例.*`. Remove prototype labels, hard-coded content cards, query-string screenshot controls, and demo-only toasts. Keep these stable DOM anchors:

```html
<nav id="top-nav">
  <button data-page="prompts">提示词管理工具</button>
  <button data-page="schedule">日程管理</button>
  <button data-page="settings">设置</button>
</nav>
<section id="page-prompts" class="page"></section>
<section id="page-schedule" class="page"></section>
<section id="page-settings" class="page"></section>
<div id="modal-root"></div>
<div id="toast" role="status" aria-live="polite"></div>
```

Use `workspace.js` to switch pages, persist `lastPage`, restore it from `getState()`, and wire custom window buttons.

- [ ] **Step 6: Replace the right-click configuration entry**

Keep the existing renderer call name temporarily (`setConfigOpen`) but route `window:set-config-open(true)` to `workspaceWindow.open()`. Load `workspace.html` rather than `index.html?mode=config`. Remove the obsolete config-window drag ledger from main.js; the native resizable window uses CSS `-webkit-app-region: drag` on the title bar and `no-drag` on buttons.

- [ ] **Step 7: Add offscreen UI smoke capture**

Create `scripts/capture-workspace.js` using the proven `app.disableHardwareAcceleration()`, a temporary userData folder, 1280×820 BrowserWindow, and `capturePage()`. It must assert:

```js
const labels = await win.webContents.executeJavaScript(
  `[...document.querySelectorAll('#top-nav [data-page]')].map(x => x.textContent.trim())`
);
assert.deepEqual(labels, ['提示词管理工具', '日程管理', '设置']);
```

Save screenshots under `output/phase3-workspace-qa/` and never read or write the real electron-store.

- [ ] **Step 8: Run P3-M1 verification**

Run: `npm run test:workspace`

Run: `node --check main.js workspace-preload.js workspace.js main/workspace-window.js`

Run: `npm start`

Manually verify right-click opens the formal window, the pet remains in place, all three pages switch in one click, resizing stops at 960×640, and closing the workspace leaves the pet running.

- [ ] **Step 9: Update the log and commit P3-M1**

```bash
git add main.js preload.js main/workspace-window.js workspace-preload.js workspace.html workspace.css workspace.js renderer/workspace-ui.mjs renderer/workspace-model.mjs tests/workspace-model.test.mjs scripts/capture-workspace.js package.json 开发日志/开发日志.md
git commit -m "feat: add formal phase three workspace window"
```

---

### Task 4 — P3-M2: Implement spaces and unified prompt/command entries

**Files:**
- Create: `renderer/prompts.mjs`
- Modify: `renderer/workspace-model.mjs`
- Modify: `tests/workspace-model.test.mjs`
- Modify: `workspace.html`
- Modify: `workspace.css`
- Modify: `workspace.js`
- Modify: `workspace-preload.js`
- Modify: `main.js`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Consumes: `WorkspaceRepository` space and entry methods.
- Produces IPC channels `workspace:space-add/update/reorder/delete` and `workspace:entry-add/update/remove`.
- Produces `createPromptsController({ root, api, ui, getState, refreshState })` with `render()` and `destroy()`.

- [ ] **Step 1: Replace the model smoke test with filtering and sorting tests**

Test case-insensitive title/content search, type filtering, pinned-first stability, updated-descending order, title locale order, and input immutability:

```js
test('filters by content and sorts pinned entries without mutating input', () => {
  const entries = [
    { id: 'a', type: 'command', title: 'Build', content: 'npm run dist', pinned: false, updatedAt: 2 },
    { id: 'b', type: 'prompt', title: '海报', content: '夜幕 poster', pinned: true, updatedAt: 1 }
  ];
  const result = filterAndSortEntries(entries, { query: 'poster', type: 'prompt', sort: 'pinned' });
  assert.deepEqual(result.map((x) => x.id), ['b']);
  assert.deepEqual(entries.map((x) => x.id), ['a', 'b']);
});
```

- [ ] **Step 2: Run the model test and confirm behavioral failures**

Run: `node --test tests/workspace-model.test.mjs`

Expected: at least the query/type/sort assertions FAIL.

- [ ] **Step 3: Implement the pure entry view model**

```js
export function filterAndSortEntries(entries, { query = '', type = 'all', sort = 'pinned' } = {}) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  const filtered = entries.filter((entry) => {
    const matchesType = type === 'all' || entry.type === type;
    const haystack = `${entry.title}\n${entry.content}`.toLocaleLowerCase('zh-CN');
    return matchesType && (!needle || haystack.includes(needle));
  });
  return filtered.toSorted(entryComparator(sort));
}
```

If the bundled JavaScript runtime lacks `toSorted`, use `[...filtered].sort(...)` and keep the immutability assertion.

- [ ] **Step 4: Add workspace IPC with allowlisted payload validation**

Every handler must call a repository method, broadcast `workspace:data-changed` to the workspace window, and return the new public state. Do not send full electron-store settings.

```js
ipcMain.handle('workspace:space-add', (_event, input) => mutate(() => workspaceRepository.addSpace(input)));
ipcMain.handle('workspace:entry-add', (_event, input) => mutate(() => workspaceRepository.addEntry(input)));
```

Extend `workspace-preload.js` with one method per channel rather than a generic invoke function.

- [ ] **Step 5: Implement prompt-space DOM rendering safely**

Build the sidebar, toolbar, responsive card grid, empty state, and drawer using `document.createElement`, `textContent`, and `replaceChildren`. Keep entry content limits visible in the form. Required interactions:

- Select, add, rename, reorder, and delete one-level spaces.
- Require a migrate/delete choice before deleting a non-empty space.
- Add, edit, delete, pin, favorite, move, search, filter, sort, and copy entries.
- Use a large card when `coverId` exists and a compact card otherwise.
- Single click opens the drawer; copy buttons copy; double-clicking content copies.
- Never add an execute button for `type: 'command'`.

- [ ] **Step 6: Run P3-M2 tests and interactive checks**

Run: `npm run test:workspace`

Run: `node --check main.js workspace-preload.js workspace.js`

Run: `npm start`

Create two spaces, rename one, reorder them, add one prompt and one command, search by body text, move an entry, pin and favorite it, copy both types, restart, and confirm persistence. Delete a non-empty space via migration and confirm no entry disappears.

- [ ] **Step 7: Update the log and commit P3-M2**

```bash
git add main.js workspace-preload.js workspace.html workspace.css workspace.js renderer/prompts.mjs renderer/workspace-model.mjs tests/workspace-model.test.mjs 开发日志/开发日志.md
git commit -m "feat: add prompt and command workspaces"
```

---

### Task 5 — P3-M3: Add safe local cover import and finish the detail drawer

**Files:**
- Create: `main/prompt-covers.js`
- Create: `tests/prompt-covers.test.js`
- Modify: `package.json`
- Modify: `main.js`
- Modify: `workspace-preload.js`
- Modify: `renderer/prompts.mjs`
- Modify: `workspace.css`
- Modify: `scripts/capture-workspace.js`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Produces `createPromptCoverStore({ userDataPath, fs, path, randomUUID })` with `importFile`, `remove`, `resolve`.
- Produces `installPromptCoverProtocol({ protocol, net, pathToFileURL, coverStore })` for `pet-cover://file/<coverId>`.
- Extends the workspace bridge with `selectCover`, `importDroppedCover(file)`, and `removeCover`.

- [ ] **Step 1: Add the cover-store test command and failing tests**

Include `tests/prompt-covers.test.js` in `test:workspace`. Use a per-test temporary directory and cover these exact cases:

```js
test('imports png jpeg and webp into prompt-covers with generated names', () => {});
test('rejects unsupported extensions and files larger than 10 MiB', () => {});
test('resolve rejects traversal and missing files', () => {});
test('replacing and removing a cover cleans only managed files', () => {});
```

Run: `node --test tests/prompt-covers.test.js`

Expected: FAIL because the module is missing.

- [ ] **Step 2: Implement the managed cover store**

Use an extension-to-MIME map, `fs.statSync`, `fs.mkdirSync({ recursive: true })`, and `fs.copyFileSync`. A valid ID matches:

```js
const COVER_ID = /^[a-f0-9-]+\.(png|jpe?g|webp)$/i;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
```

`resolve(id)` must verify the regex, verify `path.basename(id) === id`, resolve below the managed directory, and return `null` for missing files.

- [ ] **Step 3: Register a safe custom protocol**

Before `app.whenReady()`, register the scheme as standard and secure. Inside ready, install a handler that validates the ID through `coverStore.resolve()` and returns `new Response('Not found', { status: 404 })` on failure. Never serve an arbitrary path supplied by the renderer.

- [ ] **Step 4: Implement file selection and drop import**

`selectCover(entryId)` opens `dialog.showOpenDialog` with PNG/JPEG/WebP filters. For drag/drop, use Electron 31 `webUtils.getPathForFile(file)` inside `workspace-preload.js` and pass only that path to the main-process import handler. Main validates the path and file again.

- [ ] **Step 5: Complete the drawer visuals and fallbacks**

Match the approved screenshot: 390px drawer at normal width, full overlay under 760px available content width, cover action button, title/body fields, space/type selectors, pin/favorite controls, delete, copy, and save. Use a themed gradient placeholder when the `pet-cover` image emits `error`.

- [ ] **Step 6: Verify P3-M3**

Run: `npm run test:workspace`

Run: `npm start`

Import each allowed format, reject a `.txt`, replace a cover, restart and confirm it persists, remove it and confirm the managed file is gone, then drag/drop a cover. Confirm the original source file remains untouched.

Run the offscreen capture and inspect the prompt page and open-drawer screenshots.

- [ ] **Step 7: Update the log and commit P3-M3**

```bash
git add main/prompt-covers.js tests/prompt-covers.test.js package.json main.js workspace-preload.js renderer/prompts.mjs workspace.css scripts/capture-workspace.js 开发日志/开发日志.md
git commit -m "feat: add managed prompt cover images"
```

---

### Task 6 — P3-M4: Implement the persisted daily three-column task board

**Files:**
- Create: `renderer/schedule.mjs`
- Modify: `renderer/workspace-model.mjs`
- Modify: `tests/workspace-model.test.mjs`
- Modify: `tests/workspace-repository.test.js`
- Modify: `workspace.html`
- Modify: `workspace.css`
- Modify: `workspace.js`
- Modify: `workspace-preload.js`
- Modify: `main.js`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Produces `groupTasksByStatus(tasks, selectedDate, query)` and `formatTaskDate` in the pure model.
- Produces IPC `workspace:task-add/update/remove`.
- Produces `createScheduleController({ root, api, ui, getState, refreshState })` with internal views `board`, `calendar`, `reminders`.

- [ ] **Step 1: Write failing board grouping and task persistence tests**

```js
test('groups only selected local-date tasks into stable board columns', () => {
  const tasks = [
    { id: 'a', date: '2026-08-26', status: 'doing', title: 'A', updatedAt: 2 },
    { id: 'b', date: '2026-08-27', status: 'todo', title: 'B', updatedAt: 3 }
  ];
  const grouped = groupTasksByStatus(tasks, '2026-08-26', '');
  assert.deepEqual(grouped.todo, []);
  assert.deepEqual(grouped.doing.map((x) => x.id), ['a']);
  assert.deepEqual(grouped.done, []);
});
```

Repository tests must assert task add/edit/status move/delete persist after constructing a second repository with the same MemoryStore.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/workspace-model.test.mjs tests/workspace-repository.test.js`

Expected: FAIL on grouping or task mutation assertions.

- [ ] **Step 3: Implement pure board grouping and repository task mutations**

Sort each column by explicit `time` first, then priority rank `high → normal → low`, then `createdAt`. Keep date comparisons as `YYYY-MM-DD` string equality.

- [ ] **Step 4: Add task IPC and task form**

Task payload fields are exactly `title`, `date`, `time`, `status`, `priority`, `notes`, and `withReminder`. Validate title non-empty, valid date, valid optional `HH:mm`, known enums, and text limits in the repository rather than only in the renderer.

- [ ] **Step 5: Implement board interactions**

Match the approved three-column layout. Implement:

- Previous date, next date, and `今天`.
- Search within the selected date.
- New/edit/delete task modal.
- HTML drag/drop with rollback on rejected mutation.
- Keyboard-accessible status menu with the same three states.
- Column counts derived from grouped data, never manually incremented.
- Task cards showing title, time/all-day, priority, reminder state, and notes preview.

- [ ] **Step 6: Verify P3-M4**

Run: `npm run test:workspace`

Run: `npm start`

Create tasks for two dates and all three columns, move tasks by drag and by keyboard menu, edit priority/time/notes, search, restart, and confirm all state. Confirm today switching uses the local date.

- [ ] **Step 7: Update the log and commit P3-M4**

```bash
git add main.js workspace-preload.js workspace.html workspace.css workspace.js renderer/schedule.mjs renderer/workspace-model.mjs tests/workspace-model.test.mjs tests/workspace-repository.test.js 开发日志/开发日志.md
git commit -m "feat: add persisted daily task board"
```

---

### Task 7 — P3-M5: Add month calendar, reminder management, and atomic task-reminder links

**Files:**
- Modify: `main/workspace-repository.js`
- Modify: `main.js`
- Modify: `workspace-preload.js`
- Modify: `renderer/workspace-model.mjs`
- Modify: `renderer/schedule.mjs`
- Modify: `tests/workspace-model.test.mjs`
- Modify: `tests/workspace-repository.test.js`
- Modify: `workspace.css`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Produces `buildMonthCells(year, monthIndex, tasks, reminders)` returning exactly 42 cells.
- Extends reminders with optional `date`, `source: 'task'`, and `taskId` without changing interval/usage behavior.
- Reuses existing reminder CRUD IPC internally but exposes workspace-specific bridge methods.

- [ ] **Step 1: Write failing calendar projection tests**

```js
test('month cells include tasks and dated absolute reminders only', () => {
  const cells = buildMonthCells(2026, 7,
    [{ id: 't1', title: '录课', date: '2026-08-26', status: 'todo' }],
    [
      { id: 'r1', type: 'absolute', date: '2026-08-26', time: '10:30', text: '评审' },
      { id: 'r2', type: 'interval', intervalMin: 50, text: '休息' }
    ]
  );
  const day = cells.find((cell) => cell.date === '2026-08-26');
  assert.deepEqual(day.tasks.map((x) => x.id), ['t1']);
  assert.deepEqual(day.reminders.map((x) => x.id), ['r1']);
});
```

Add repository tests for create/update/delete task with linked reminder, delete-task branches, and removing a reminder unlinking its task.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/workspace-model.test.mjs tests/workspace-repository.test.js`

Expected: calendar and association assertions FAIL.

- [ ] **Step 3: Implement 42-cell calendar projection**

Build Monday-first cells using local dates. Each cell has:

```js
{ date: '2026-08-26', day: 26, inMonth: true, isToday: false, tasks: [], reminders: [] }
```

Include all tasks on their date. Include reminders only when `type === 'absolute'` and `date` is present. Legacy absolute reminders without a date remain manageable but do not appear as a calendar event because their recurrence is daily.

- [ ] **Step 4: Make task-reminder mutations atomic**

When saving a task with `withReminder: true`, require date and time, create/update a reminder with `{ type: 'absolute', date, time, text: title, enabled: true, source: 'task', taskId }`, then write `tasks` and `reminders` in one repository method with rollback to cloned originals if either store write throws.

When deleting a task:

- `removeReminder: false`: delete the task and keep the reminder after removing `taskId/source`.
- `removeReminder: true`: delete both.

When deleting a reminder, set matching task `reminderId` to `null` and keep the task.

- [ ] **Step 5: Extend scheduler date matching**

In `tick()`, compute `todayKey = localDateKey(now)` and gate absolute reminders:

```js
if (r.type === 'absolute' && (!r.date || r.date === todayKey)) {
  // existing HH:mm and firedAbsolute logic
}
```

Legacy undated absolute reminders retain their current daily behavior.

- [ ] **Step 6: Implement calendar and reminder views**

Calendar view requirements:

- Month previous/next buttons, Monday-first weekday header, six rows.
- Task and reminder color tokens matching the prototype.
- Click date to select it and show that day's items; new task defaults to the clicked date.
- `返回今日看板` restores board view and local today.

Reminder view requirements:

- List/add/edit/delete/enable existing absolute, interval, and usage reminders.
- Show dated absolute reminders as calendar-visible.
- State clearly that interval and usage reminders do not fill the calendar.
- Preserve the existing trigger, sound, voice, and pet animation behavior.

- [ ] **Step 7: Verify P3-M5**

Run: `npm test`

Run: `npm start`

Create a task reminder for today a few minutes ahead, confirm it appears once on the calendar and triggers through the existing pet presentation. Verify interval and usage reminders do not appear in the calendar. Exercise both task deletion choices and direct reminder deletion.

- [ ] **Step 8: Update the log and commit P3-M5**

```bash
git add main/workspace-repository.js main.js workspace-preload.js renderer/workspace-model.mjs renderer/schedule.mjs tests/workspace-model.test.mjs tests/workspace-repository.test.js workspace.css 开发日志/开发日志.md
git commit -m "feat: integrate calendar tasks and reminders"
```

---

### Task 8 — P3-M6: Implement the single settings page and close the API-key exposure

**Files:**
- Create: `renderer/settings.mjs`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `workspace-preload.js`
- Modify: `workspace.html`
- Modify: `workspace.css`
- Modify: `workspace.js`
- Modify: `renderer.js`
- Modify: `tests/workspace-repository.test.js`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Produces IPC `workspace:update-general-settings`, `workspace:save-chat-config`, `workspace:clear-chat-history`, `workspace:open-data-dir`.
- `workspace:get-state` returns `chat: { baseUrl, model, systemPrompt, keyConfigured }` and never `apiKey`.
- Chat config save accepts `{ apiKey, baseUrl, model, systemPrompt, clearApiKey }`; blank `apiKey` preserves the stored key unless `clearApiKey` is true.

- [ ] **Step 1: Write the secret-sanitization and settings tests**

Add repository/main helper tests asserting a public-state serializer removes API keys from nested settings and returns only `keyConfigured: true`. Test general setting normalization for `alwaysOnTop`, `launchAtLogin`, `volume` clamped to `0..1`, and `reducedMotion`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:workspace`

Expected: public state or settings normalization assertions FAIL.

- [ ] **Step 3: Implement public-state sanitization before any renderer IPC**

Create one helper used by both `data:get-all` and `workspace:get-state`:

```js
function publicChatSettings(chat, env) {
  return {
    baseUrl: String(chat?.baseUrl || ''),
    model: String(chat?.model || ''),
    systemPrompt: String(chat?.systemPrompt || ''),
    keyConfigured: Boolean(String(chat?.apiKey || env?.DEEPSEEK_API_KEY || '').trim())
  };
}
```

Remove the current real key from `data:get-all`. The pet renderer no longer owns a chat-settings form after this task, so it does not need the secret or editable configuration.

- [ ] **Step 4: Implement general settings mutations**

- `alwaysOnTop`: store and apply to pet and workspace immediately.
- `launchAtLogin`: call `app.setLoginItemSettings({ openAtLogin: value })`, then store the successfully applied value.
- `volume`: clamp and store; pet reminder playback reads current state on `data:changed`.
- `reducedMotion`: store and apply a `reduced-motion` body class in both renderers.
- `open-data-dir`: call `shell.openPath(app.getPath('userData'))` and return a normalized success/error object.

- [ ] **Step 5: Implement safe chat config save semantics**

Preserve the current stored key when the password field is blank. Replace it only when a non-empty new key is submitted. Clear only after an explicit confirmation sends `clearApiKey: true`. Continue to support `.env` fallback.

- [ ] **Step 6: Implement the complete one-page settings UI**

Match the approved screenshot but keep it one top-level page with no tabs, sub-navigation, dropdown, or modal. Render two visual cards on the same scroll page:

- General: always on top, launch at login, reminder volume, reduce motion, data directory.
- Model: key configured status/password replacement, base URL, model, persona, save, clear history.

Place version/data information and the secondary `退出宠物` action at the bottom. Boolean and volume controls save immediately; model fields use an explicit save button.

- [ ] **Step 7: Verify P3-M6 security and behavior**

Run: `npm test`

Run this source scan and require no real-key return path:

```powershell
rg -n "apiKey" main.js preload.js workspace-preload.js renderer.js workspace.js renderer
```

Inspect each hit. Renderer-facing state may contain only the field name in an outgoing save payload or `keyConfigured`; it must not receive a stored key.

Run: `npm start`

Toggle each general setting, restart, confirm persistence, save model fields with a blank key and confirm the old key remains usable, explicitly clear it and confirm the UI changes to unconfigured, then restore via `.env` or a new key.

- [ ] **Step 8: Update the log and commit P3-M6**

```bash
git add main.js preload.js workspace-preload.js workspace.html workspace.css workspace.js renderer/settings.mjs renderer.js tests/workspace-repository.test.js 开发日志/开发日志.md
git commit -m "feat: add unified workspace settings page"
```

---

### Task 9 — P3-M7: Remove the old config UI, harden responsive/multi-screen behavior, package, and complete acceptance

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `renderer.js`
- Modify: `preload.js`
- Modify: `main.js`
- Modify: `workspace.html`
- Modify: `workspace.css`
- Modify: `workspace.js`
- Modify: `main/workspace-window.js`
- Modify: `scripts/capture-workspace.js`
- Modify: `scripts/dist-temp.ps1`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/需求规范.md`
- Modify: `docs/技术规范.md`
- Modify: `docs/设计规范.md`
- Modify: `docs/开发步骤.md`
- Modify: `开发日志/开发日志.md`

**Interfaces:**
- Consumes every completed feature from P3-M0 through P3-M6.
- Produces the final v3 packaged application and final QA screenshots.
- Removes obsolete config-mode branches and command/config IPC only after all workspace replacements are verified.

- [ ] **Step 1: Add final static and offscreen assertions**

Extend `scripts/capture-workspace.js` to capture and assert these states at both 1280×820 and 960×640:

```text
01-prompts.png
02-prompt-drawer.png
03-board.png
04-calendar.png
05-reminders.png
06-settings.png
07-prompts-minimum.png
08-board-minimum.png
```

The script must assert no horizontal document overflow, exactly three top navigation items, visible window controls, a responsive card grid, three board columns at default width, and usable horizontal/vertical fallback at minimum width.

- [ ] **Step 2: Remove obsolete configuration-mode code**

After the formal workspace passes:

- Delete `#panel`, old command/reminder/chat config tabs, and config-only theme particles from `index.html`.
- Delete `isConfigWindow`, `createCommandWidget`, `createReminderWidget`, `createChatConfigWidget`, config drag code, and config-only initialization from `renderer.js`.
- Delete config-panel CSS selectors from `styles.css` while preserving chat and reminder bubble styles.
- Rename bridge comments and optionally rename `setConfigOpen` to `setWorkspaceOpen` in both preload and renderer in one atomic edit.
- Remove legacy command CRUD IPC only after no renderer references remain; retain legacy data backup for one release.

Run:

```powershell
rg -n "isConfigWindow|ptab-|cmd-widget-panel|rem-widget-panel|chat-widget-panel|panel-footer|window:drag-start" index.html renderer.js styles.css
```

Expected: no old config UI references; pet drag IPC remains only where required for the pet.

- [ ] **Step 3: Finish responsive and multi-screen behavior**

- Persist non-maximized workspace bounds and maximized state.
- Restore to a valid display or center nearest the cursor.
- Test 100%, 125%, and mixed-DPI displays when available.
- At wide sizes, card grid reaches three columns; at narrower sizes it falls to two/one.
- The space sidebar can collapse; the drawer becomes an overlay on narrow content.
- The board remains usable at 960×640 through column minimum widths and controlled scrolling.
- Honor `prefers-reduced-motion` and the stored reduce-motion setting.

- [ ] **Step 4: Update packaging whitelist and purity check**

Add these production paths to `package.json.build.files` and the top-level allowlist in `scripts/dist-temp.ps1`:

```text
workspace.html
workspace.css
workspace.js
workspace-preload.js
main/**/*
renderer/**/*
```

Include only production assets; exclude `phase3-review/`, `tests/`, `output/`, and QA screenshots. The packaged app must still exclude `.env`, user data, and cover images from the developer machine.

- [ ] **Step 5: Run the complete automated verification**

Run:

```powershell
npm test
node --check main.js preload.js workspace-preload.js renderer.js workspace.js chat.js
node --check main/workspace-schema.js main/workspace-repository.js main/workspace-window.js main/prompt-covers.js
```

Run the offscreen workspace capture and visually inspect all eight images.

Run `git diff --check` and require no whitespace errors.

- [ ] **Step 6: Run the required real Electron acceptance**

Run: `npm start`

Verify every acceptance item from `phase3-review/三期需求头脑风暴与产品方案.md` section 12, including right-click entry, pet position stability, window controls, resize limits, spaces, entry migration, covers, board drag, calendar contents, linked reminders, settings, restart persistence, chat, reminder animation/audio, and complete application exit.

If the managed environment still cannot launch Electron, record the exact error and perform this step on the normal Windows desktop before declaring P3-M7 complete.

- [ ] **Step 7: Build and inspect the installation package**

Run: `npm run dist:clean`

Expected:

- electron-builder succeeds.
- asar purity validation passes with the expanded whitelist.
- The installer contains workspace production files and theme assets.
- It contains no `.env`, electron-store data, prompt cover data, tests, `phase3-review/`, or QA output.
- A clean installation launches the pet, opens the workspace, and starts with empty user content plus the preserved built-in usage reminder.

- [ ] **Step 8: Finish documentation and log**

Mark P3-M0 through P3-M7 complete only for steps actually verified. Update README usage text and all four formal specs to the shipped behavior. Record test counts, package version, installer name, any environment-only limitation, and remaining future scope in `开发日志/开发日志.md`.

- [ ] **Step 9: Final commit**

```bash
git add index.html styles.css renderer.js preload.js main.js workspace.html workspace.css workspace.js workspace-preload.js main renderer scripts/capture-workspace.js scripts/dist-temp.ps1 package.json README.md docs 开发日志/开发日志.md
git commit -m "feat: complete phase three workspace"
```

---

## Plan Self-Review

### Spec coverage

- Formal resizable workspace and window lifecycle: Tasks 3 and 9.
- Exact three-item navigation and settings without sub-navigation: Tasks 3 and 8.
- One-level spaces and unified prompt/command cards: Task 4.
- Local managed covers and detail drawer: Task 5.
- Daily three-column board: Task 6.
- Month calendar, existing reminder management, and task links: Task 7.
- General/model settings and API-key safety: Task 8.
- Legacy data migration, backup, and recovery: Tasks 1 and 2.
- Responsive, multi-screen, package purity, and total acceptance: Task 9.
- Existing pet, chat, notification, and no-command-execution boundaries: Global constraints and Tasks 3, 7, 8, 9.

### Type and interface consistency

- Entry types remain `prompt | command` from schema through repository, IPC, model, and UI.
- Task statuses remain `todo | doing | done`; priorities remain `low | normal | high`.
- Dates remain local `YYYY-MM-DD`; optional time remains `HH:mm`.
- Entry cover references use a managed `coverId`, never an arbitrary renderer path.
- Task/reminder linkage uses `task.reminderId` and `reminder.taskId`; direct removal unlinks the surviving object.
- Renderer state exposes `keyConfigured`, never the stored `apiKey`.

### Scope discipline

This plan does not add nested spaces, cloud sync, prompt variables, remote cover URLs, command execution, weekly timelines, complex recurrence, missed-reminder compensation, or agent tool calls.
