// workspace.js · 工作台渲染层
// P3-M1：四项顶部导航路由 + 自定义标题栏窗口控制
// P3-M2~M6：项目空间 / 提示词与封面 / 记事本 / 任务、月历与提醒
// 安全约定与 renderer.js 一致：用户输入一律 createElement + textContent 渲染，禁止 innerHTML 拼接

const $ = (sel) => document.querySelector(sel);
const api = window.petAPI;
const { shouldMapRangeTask } = window.taskRules;

const PAGES = ['notes', 'prompts', 'schedule', 'settings'];
const GLYPHS = ['night', 'mint', 'gold', 'pink', 'cyan'];

// ---------- 工具：安全 DOM 构造 ----------
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function fmtDate(ts) {
  const d = new Date(ts || 0);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function localIsoDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, amount) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + amount);
  return localIsoDate(date);
}

function shortIsoDate(iso) {
  const parts = String(iso || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : '未设置';
}

// ---------- P3-M1：页面路由 ----------
function showPage(page) {
  if (!PAGES.includes(page)) page = 'prompts';
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach((s) => {
    s.classList.toggle('active', s.id === `page-${page}`);
  });
  api.workspaceSetPage(page);
}

document.querySelectorAll('.nav-item').forEach((b) => {
  b.addEventListener('click', () => showPage(b.dataset.page));
});

// ---------- P3-M1：自定义标题栏窗口控制 ----------
document.querySelectorAll('[data-window-action]').forEach((b) => {
  b.addEventListener('click', () => api.workspaceWinControl(b.dataset.windowAction));
});

// 标题栏空白处双击最大化/还原（Windows 惯例）；拖动移动由 CSS -webkit-app-region: drag 实现
$('#titlebar').addEventListener('dblclick', (e) => {
  if (e.target.closest('[data-window-action]')) return;
  api.workspaceWinControl('maximize');
});

// 主进程同步最大化状态：切换「最大化/还原」按钮图形与无障碍标签
api.onWorkspaceWinState((d) => {
  document.body.classList.toggle('is-maximized', !!d.maximized);
  const btn = document.querySelector('[data-window-action="maximize"]');
  btn.setAttribute('aria-label', d.maximized ? '还原' : '最大化');
});

// ---------- P3-M2：提示词管理页状态 ----------
const state = {
  spaces: [],
  entries: [],
  notes: [],
  tasks: [],
  reminders: [],
  settings: {},
  envFile: '',
  dataPath: '',
  version: '',
  defaultSpaceId: '',
  spaceId: null, // null = 全部内容
  filter: 'all', // all | prompt | command
  sort: 'pinned', // pinned | updated | title
  q: '',
  noteSpaceId: null, // null = 全部笔记
  noteQ: '',
  noteSort: 'updated',
  selectedDate: localIsoDate(),
  taskQ: '',
  scheduleView: 'board',
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth()
};

async function reload() {
  const data = await api.workspaceGetData();
  applyData(data);
}

// 应用最新数据（拉取与 CRUD 响应共用）：当前空间被删时回退到「全部内容」
function applyData(data) {
  state.spaces = (data && data.spaces) || [];
  state.entries = (data && data.entries) || [];
  state.notes = (data && data.notes) || [];
  state.tasks = (data && data.tasks) || [];
  state.reminders = (data && data.reminders) || [];
  state.defaultSpaceId = (data && data.defaultSpaceId) || '';
  if (state.spaceId && !state.spaces.some((s) => s.id === state.spaceId)) state.spaceId = null;
  if (state.noteSpaceId && !state.spaces.some((s) => s.id === state.noteSpaceId)) state.noteSpaceId = null;
  render();
}

// CRUD 响应统一处理：成功更新并重渲染；失败 toast 错误
function handleResult(res) {
  if (!res || res.ok !== true) {
    showToast((res && res.error) || '操作失败');
    return false;
  }
  applyData(res);
  return true;
}

function countIn(spaceId) {
  return state.entries.filter((e) => e && e.spaceId === spaceId).length;
}

async function loadWorkspaceSettings() {
  const res = await api.workspaceSettingsGet();
  if (!res || res.ok !== true) { setSettingsSaveState((res && res.error) || '设置读取失败', 'error'); return false; }
  state.settings = res.settings || {};
  state.envFile = res.envFile || '';
  state.dataPath = res.dataPath || '';
  state.version = res.version || '';
  renderSettings();
  return true;
}

function noteCountIn(spaceId) {
  return state.notes.filter((note) => note && note.spaceId === spaceId).length;
}

function totalCountIn(spaceId) {
  return countIn(spaceId) + noteCountIn(spaceId);
}

// ---------- P3-M2：渲染 ----------
function render() {
  renderHeader();
  renderSpaces();
  renderCards();
  renderNotes();
  renderSchedule();
}

function renderHeader() {
  const space = state.spaces.find((s) => s.id === state.spaceId);
  const name = space ? space.name : '全部内容';
  $('#current-space').textContent = name;
  $('#workspace-title').textContent = name;
  $('#workspace-description').textContent = space
    ? `该空间现有 ${countIn(space.id)} 条内容。`
    : '集中整理命令和提示词，快速查找、编辑与复制。';
}

function renderSpaces() {
  const list = $('#space-list');
  list.textContent = '';
  list.appendChild(spaceItem(null, '全部内容', state.entries.length));
  state.spaces.forEach((s, i) => {
    list.appendChild(spaceItem(s.id, s.name, countIn(s.id), i));
  });
}

function spaceItem(id, name, count, index) {
  const glyphClass = id === null ? 'night' : GLYPHS[(index + 1) % GLYPHS.length];
  const glyphText = id === null ? '✦' : (name.trim().charAt(0) || '·');
  return el('button', {
    type: 'button',
    class: `space-item${state.spaceId === id ? ' active' : ''}`,
    onclick: () => { state.spaceId = id; render(); }
  }, [
    el('span', { class: `space-glyph ${glyphClass}`, text: glyphText }),
    el('span', { class: 'space-name', text: name }),
    el('b', { text: String(count) })
  ]);
}

// 过滤（空间 + 类型 + 标题/正文搜索）与排序（置顶优先 / 最近更新 / 标题）
function filterEntries() {
  const q = state.q.trim().toLowerCase();
  const list = state.entries.filter((e) => {
    if (!e) return false;
    if (state.spaceId && e.spaceId !== state.spaceId) return false;
    if (state.filter !== 'all' && e.type !== state.filter) return false;
    if (q && !`${e.title}\n${e.content}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (state.sort === 'title') {
    return list.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  }
  if (state.sort === 'updated') {
    return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  // 置顶优先：先按置顶分组，组内按最近更新
  return list.slice().sort((a, b) => ((b.pinned === true) - (a.pinned === true)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
}

function renderCards() {
  const list = filterEntries();
  $('#result-count').textContent = String(list.length);
  const grid = $('#prompt-grid');
  grid.textContent = '';
  // 两种空状态：完全没有内容 / 有内容但当前筛选无匹配
  $('#entry-none').hidden = state.entries.length > 0;
  $('#entry-empty').hidden = !(state.entries.length > 0 && list.length === 0);
  const spaceNameOf = (id) => {
    const s = state.spaces.find((x) => x.id === id);
    return s ? s.name : '未分组';
  };
  list.forEach((entry) => grid.appendChild(entryCard(entry, spaceNameOf(entry.spaceId))));
}

function entryCard(entry, spaceName) {
  const isCommand = entry.type === 'command';
  const coverId = entry.coverId && entry.coverId !== 'none' ? entry.coverId : 'none';
  const card = el('article', {
    class: `prompt-card ${coverId === 'none' ? 'compact' : 'featured'}`,
    tabindex: '0',
    role: 'button',
    'aria-label': `编辑 ${entry.title}`,
    onclick: () => openDrawer(entry),
    onkeydown: (e) => { if (e.key === 'Enter') openDrawer(entry); }
  });
  const meta = el('div', { class: 'card-meta' }, [
    el('span', { class: `type ${entry.type}`, text: isCommand ? '命令' : '提示词' }),
    entry.pinned === true ? el('span', { class: 'pin-text', text: '置顶' }) : null
  ]);
  const body = el('div', { class: 'card-body' }, [
    meta,
    el('h3', { text: entry.title }),
    isCommand ? el('pre', { class: 'card-copy', text: entry.content }) : el('p', { class: 'card-copy', text: entry.content })
  ]);
  const footer = el('div', { class: 'card-footer' }, [
    el('span', { text: `${spaceName} · ${fmtDate(entry.updatedAt)}` }),
    el('button', {
      type: 'button',
      class: 'copy-button',
      text: '复制',
      onclick: (ev) => { ev.stopPropagation(); copyEntry(entry); }
    })
  ]);
  if (coverId !== 'none') card.appendChild(entryCover(entry, coverId));
  card.appendChild(body);
  card.appendChild(footer);
  return card;
}

function entryCover(entry, coverId) {
  const kind = coverId.startsWith('data:') ? 'custom' : coverId;
  const cover = el('div', { class: `cover ${kind === 'character' ? 'cover-character' : kind === 'poster' ? 'cover-poster' : 'custom-cover'}` });
  cover.appendChild(el('button', {
    type: 'button',
    class: 'cover-copy-button',
    text: '复制图片',
    onclick: (ev) => { ev.stopPropagation(); copyEntryCover(entry); }
  }));
  if (kind === 'character') {
    cover.appendChild(el('img', { src: 'assets/chat-avatar.png', alt: '' }));
  } else if (kind === 'poster') {
    cover.appendChild(el('div', { class: 'cover-copy' }, [
      el('small', { text: 'NEON POSTER' }), el('strong', { text: '夏夜萤光' }), el('span', { text: 'Visual Study 03' })
    ]));
  } else {
    cover.appendChild(el('img', { src: coverId, alt: '' }));
  }
  cover.appendChild(el('span', { class: 'cover-chip', text: kind === 'custom' ? '本地图片' : kind === 'character' ? '角色例图' : '萤光海报' }));
  return cover;
}

// ---------- 复制（命令只复制不执行，技术规范 §7 安全红线） ----------
function copyEntry(entry) {
  api.copyText(entry.content);
  showToast('已复制到剪贴板');
}

async function copyEntryCover(entry) {
  const res = await api.entryCopyCover(entry.coverId);
  showToast(res && res.ok ? '图片已复制到剪贴板' : (res && res.error) || '复制图片失败');
}

// ---------- P3-M3：内容详情抽屉与封面管理 ----------
let drawerEditingId = null; // null = 新建
let drawerCoverId = 'none';

function openDrawer(entry) {
  drawerEditingId = entry ? entry.id : null;
  $('#entry-mode-label').textContent = entry ? '编辑内容' : '新建内容';
  $('#entry-drawer-type').textContent = entry && entry.type === 'command' ? '命令' : '提示词';
  $('#entry-id').value = entry ? entry.id : '';
  $('#entry-type').value = entry ? entry.type : 'prompt';
  renderSpaceOptions(entry ? entry.spaceId : defaultSpaceForNew());
  $('#entry-title').value = entry ? entry.title : '';
  $('#entry-content').value = entry ? entry.content : '';
  drawerCoverId = entry && entry.coverId && entry.coverId !== 'none' ? entry.coverId : 'none';
  $('#entry-cover').value = drawerCoverId === 'none' ? 'none' : 'image';
  $('#entry-cover-file').value = '';
  $('#entry-pinned').checked = entry ? entry.pinned === true : false;
  $('#entry-delete').hidden = !entry;
  clearFieldError('entry-title');
  clearFieldError('entry-content');
  updateCharCount();
  updateCoverPreview();
  $('#drawer-backdrop').classList.add('open');
  $('#entry-drawer').classList.add('open');
  $('#entry-drawer').setAttribute('aria-hidden', 'false');
  $('#entry-title').focus();
}

function closeDrawer() {
  drawerEditingId = null;
  $('#drawer-backdrop').classList.remove('open');
  $('#entry-drawer').classList.remove('open');
  $('#entry-drawer').setAttribute('aria-hidden', 'true');
}

function defaultSpaceForNew() {
  if (state.spaceId) return state.spaceId;
  return state.spaces.length > 0 ? state.spaces[0].id : '';
}

function renderSpaceOptions(selectedId) {
  const select = $('#entry-space');
  select.textContent = '';
  state.spaces.forEach((s) => {
    select.appendChild(el('option', { value: s.id, text: s.name }));
  });
  if (selectedId && state.spaces.some((s) => s.id === selectedId)) select.value = selectedId;
  else if (state.spaces.length > 0) select.value = state.spaces[0].id;
}

$('#entry-create-btn').addEventListener('click', () => openDrawer(null));
$('#entry-none-create').addEventListener('click', () => openDrawer(null));
$('#entry-drawer-close').addEventListener('click', closeDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);

$('#entry-type').addEventListener('change', (e) => {
  $('#entry-drawer-type').textContent = e.target.value === 'command' ? '命令' : '提示词';
});

function updateCoverPreview() {
  const preview = $('#entry-cover-preview');
  const imageMode = $('#entry-cover').value === 'image';
  preview.className = 'drawer-cover';
  preview.style.backgroundImage = '';
  $('#cover-preview-kicker').textContent = imageMode ? 'IMAGE CARD' : 'COMPACT CARD';
  $('#cover-preview-title').textContent = imageMode ? '包含图片的卡片' : '无图片的紧凑卡片';
  $('#cover-preview-hint').textContent = imageMode ? '图片可在卡片上快速复制' : '选择本地图片后自动切换为带图卡片';
  if (!imageMode) {
    preview.classList.add('no-cover-preview');
  } else if (drawerCoverId.startsWith('data:')) {
    preview.classList.add('custom-preview');
    preview.style.backgroundImage = `linear-gradient(rgba(8,19,38,.08),rgba(8,19,38,.32)), url("${drawerCoverId}")`;
  } else if (drawerCoverId === 'poster') {
    // 默认样式即萤光海报。
  } else {
    preview.classList.add('character-preview');
  }
}

$('#entry-cover').addEventListener('change', (e) => {
  if (e.target.value === 'image' && drawerCoverId === 'none') drawerCoverId = 'character';
  updateCoverPreview();
});

$('#entry-cover-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    e.target.value = '';
    showToast('请选择 PNG、JPEG 或 WebP 图片');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    e.target.value = '';
    showToast('图片不能超过 5MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    drawerCoverId = String(reader.result || 'none');
    $('#entry-cover').value = 'image';
    updateCoverPreview();
    showToast('图片已载入，卡片已切换为带图样式');
  };
  reader.onerror = () => showToast('图片读取失败');
  reader.readAsDataURL(file);
});

function updateCharCount() {
  $('#entry-char-count').textContent = `${$('#entry-content').value.length} / 2000`;
}
$('#entry-content').addEventListener('input', () => {
  clearFieldError('entry-content');
  updateCharCount();
});
$('#entry-title').addEventListener('input', () => clearFieldError('entry-title'));

$('#entry-copy').addEventListener('click', () => {
  const content = $('#entry-content').value;
  if (!content.trim()) { showToast('暂无正文可复制'); return; }
  api.copyText(content);
  showToast('已复制到剪贴板');
});

// 字段级校验错误展示（主进程仍做最终校验，双保险）
function setFieldError(inputId, message) {
  const input = $('#' + inputId);
  if (input) input.classList.add('error');
  const err = document.querySelector(`[data-error-for="${inputId}"]`);
  if (err) err.textContent = message;
}

function clearFieldError(inputId) {
  const input = $('#' + inputId);
  if (input) input.classList.remove('error');
  const err = document.querySelector(`[data-error-for="${inputId}"]`);
  if (err) err.textContent = '';
}

$('#entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#entry-title').value.trim();
  const content = $('#entry-content').value;
  let bad = false;
  if (!title) { setFieldError('entry-title', '请输入标题'); bad = true; }
  if (!content.trim()) { setFieldError('entry-content', '请输入正文'); bad = true; }
  if (bad) return;
  const editingId = drawerEditingId;
  const res = await api.entrySave({
    id: editingId || '',
    type: $('#entry-type').value,
    spaceId: $('#entry-space').value,
    title,
    content,
    pinned: $('#entry-pinned').checked,
    coverId: $('#entry-cover').value === 'none' ? 'none' : (drawerCoverId === 'none' ? 'character' : drawerCoverId)
  });
  if (!handleResult(res)) return;
  closeDrawer();
  showToast(editingId ? '内容已保存' : '内容已创建');
});

$('#entry-delete').addEventListener('click', async () => {
  if (!drawerEditingId) return;
  const entry = state.entries.find((x) => x.id === drawerEditingId);
  const answer = await confirmDialog({
    title: '删除内容',
    subtitle: '该操作不可撤销',
    message: `确定要删除「${entry ? entry.title : '该内容'}」吗？删除后无法恢复。`,
    actions: [{ label: '删除', kind: 'danger', value: 'ok' }]
  });
  if (answer !== 'ok') return;
  const res = await api.entryDelete(drawerEditingId);
  if (!handleResult(res)) return;
  closeDrawer();
  showToast('内容已删除');
});

// ---------- P3-M2：工具栏（搜索 / 筛选 / 排序） ----------
$('#prompt-search').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderCards();
});

document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderCards();
  });
});

$('#entry-sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderCards();
});

$('#clear-filter-btn').addEventListener('click', () => {
  state.q = '';
  state.filter = 'all';
  $('#prompt-search').value = '';
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all'));
  renderCards();
});

// ---------- P3-M4：记事本列表 / 编辑器 / 自动保存 ----------
let editingNoteId = null;
let noteSaveTimer = null;
let noteSavePending = false;
let noteSavePromise = null;

function renderNoteSpaces() {
  const list = $('#note-space-list');
  list.textContent = '';
  list.appendChild(noteSpaceItem(null, '全部笔记', state.notes.length));
  state.spaces.forEach((space, index) => {
    list.appendChild(noteSpaceItem(space.id, space.name, noteCountIn(space.id), index));
  });
}

function noteSpaceItem(id, name, count, index) {
  const glyphClass = id === null ? 'night' : GLYPHS[(index + 1) % GLYPHS.length];
  return el('button', {
    type: 'button',
    class: `space-item${state.noteSpaceId === id ? ' active' : ''}`,
    onclick: () => { state.noteSpaceId = id; renderNotes(); }
  }, [
    el('span', { class: `space-glyph ${glyphClass}`, text: id === null ? '✦' : (name.trim().charAt(0) || '·') }),
    el('span', { class: 'space-name', text: name }),
    el('b', { text: String(count) })
  ]);
}

function visibleNotes() {
  const q = state.noteQ.trim().toLowerCase();
  const list = state.notes.filter((note) => {
    if (!note) return false;
    if (state.noteSpaceId && note.spaceId !== state.noteSpaceId) return false;
    return !q || `${note.title || ''}\n${note.content || ''}`.toLowerCase().includes(q);
  });
  if (state.noteSort === 'title') {
    return list.slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh'));
  }
  return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderNotes() {
  const visible = visibleNotes();
  const space = state.spaces.find((s) => s.id === state.noteSpaceId);
  const name = space ? space.name : '全部笔记';
  $('#current-note-space').textContent = name;
  $('#note-workspace-title').textContent = name;
  $('#note-workspace-description').textContent = space
    ? `管理「${space.name}」空间内的记事本。`
    : '无需配置，一键新建；打开即写，内容自动保存。';
  $('#note-count').textContent = String(visible.length);
  const grid = $('#note-grid');
  grid.textContent = '';
  grid.hidden = visible.length === 0;
  $('#note-empty').hidden = visible.length > 0;
  const emptyTitle = $('#note-empty h3');
  const emptyText = $('#note-empty p');
  const hasAny = state.notes.length > 0;
  emptyTitle.textContent = hasAny ? '没有找到匹配笔记' : '还没有记事本';
  emptyText.textContent = hasAny ? '尝试更换关键词或切换记事空间。' : '点击右上角「新建内容」，无需任何配置即可开始记录。';
  visible.forEach((note) => grid.appendChild(noteCard(note)));
  renderNoteSpaces();
}

function noteCard(note) {
  const space = state.spaces.find((s) => s.id === note.spaceId);
  return el('article', {
    class: 'note-card', tabindex: '0', role: 'button',
    'aria-label': `打开 ${note.title || '无标题笔记'}`,
    onclick: () => openNoteEditor(note.id),
    onkeydown: (e) => { if (e.key === 'Enter') openNoteEditor(note.id); }
  }, [
    el('div', { class: 'note-card-top' }, [
      el('span', { class: 'note-glyph', text: '✎' }),
      el('span', { class: 'note-space-tag', text: space ? space.name : '未分类' })
    ]),
    el('h3', { text: note.title || '无标题笔记' }),
    el('p', { class: 'note-excerpt', text: note.content || '空白记事本，点击打开开始记录' }),
    el('footer', null, [
      el('span', { text: `${fmtDate(note.updatedAt)} 更新` }),
      el('span', { class: 'note-open-hint', text: '打开编辑' })
    ])
  ]);
}

function setNoteSaveState(message, mode) {
  const node = $('#note-save-state');
  node.classList.toggle('saving', mode === 'saving');
  node.classList.toggle('error', mode === 'error');
  while (node.childNodes.length > 1) node.removeChild(node.lastChild);
  node.appendChild(document.createTextNode(message));
}

function openNoteEditor(id) {
  const note = state.notes.find((item) => item && item.id === id);
  if (!note) { showToast('记事本不存在'); return; }
  editingNoteId = note.id;
  noteSavePending = false;
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  const space = state.spaces.find((s) => s.id === note.spaceId);
  $('#note-editor-space').textContent = space ? space.name : '未分类';
  $('#note-title').value = note.title || '';
  $('#note-content').value = note.content || '';
  setNoteSaveState('内容自动保存');
  $('#note-browser').hidden = true;
  $('#note-editor').hidden = false;
  $('#note-content').focus();
}

function noteDraftChanged() {
  const note = state.notes.find((item) => item && item.id === editingNoteId);
  if (!note) return;
  note.title = $('#note-title').value.trim();
  note.content = $('#note-content').value;
  note.updatedAt = Date.now();
  noteSavePending = true;
  setNoteSaveState('保存中…', 'saving');
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => { noteSaveTimer = null; saveNoteNow(); }, 450);
}

async function saveNoteNow() {
  if (noteSaveTimer) { clearTimeout(noteSaveTimer); noteSaveTimer = null; }
  if (noteSavePromise) {
    await noteSavePromise;
    return noteSavePending ? saveNoteNow() : undefined;
  }
  if (!noteSavePending || !editingNoteId) return;
  const id = editingNoteId;
  noteSavePending = false;
  const payload = { id, title: $('#note-title').value, content: $('#note-content').value };
  noteSavePromise = api.noteSave(payload).catch(() => ({ ok: false, error: '保存失败' }));
  const res = await noteSavePromise;
  noteSavePromise = null;
  if (!res || res.ok !== true) {
    setNoteSaveState((res && res.error) || '保存失败', 'error');
    return false;
  }
  if (noteSavePending) return saveNoteNow();
  state.notes = res.notes || state.notes;
  setNoteSaveState('内容自动保存');
  return true;
}

async function closeNoteEditor() {
  const saved = await saveNoteNow();
  if (saved === false) { showToast('保存失败，请稍后重试'); return; }
  $('#note-editor').hidden = true;
  $('#note-browser').hidden = false;
  editingNoteId = null;
  renderNotes();
}

async function createNote() {
  const res = await api.noteCreate(state.noteSpaceId || state.defaultSpaceId);
  if (!handleResult(res)) return;
  openNoteEditor(res.noteId);
  showToast('已新建记事本，直接开始记录');
}

async function deleteCurrentNote() {
  const note = state.notes.find((item) => item && item.id === editingNoteId);
  if (!note) return;
  const answer = await confirmDialog({
    title: '删除记事本', subtitle: '该操作不可撤销',
    message: `确定要删除「${note.title || '无标题笔记'}」吗？`,
    actions: [{ label: '删除记事本', kind: 'danger', value: 'ok' }]
  });
  if (answer !== 'ok') return;
  if (noteSaveTimer) { clearTimeout(noteSaveTimer); noteSaveTimer = null; }
  noteSavePending = false;
  if (noteSavePromise) await noteSavePromise;
  const res = await api.noteDelete(note.id);
  if (!handleResult(res)) return;
  editingNoteId = null;
  $('#note-editor').hidden = true;
  $('#note-browser').hidden = false;
  showToast('记事本已删除');
}

$('#note-create-btn').addEventListener('click', createNote);
$('#note-empty-create').addEventListener('click', createNote);
$('#note-back').addEventListener('click', closeNoteEditor);
$('#note-delete').addEventListener('click', deleteCurrentNote);
$('#note-title').addEventListener('input', noteDraftChanged);
$('#note-content').addEventListener('input', noteDraftChanged);
$('#note-search').addEventListener('input', (e) => { state.noteQ = e.target.value; renderNotes(); });
$('#note-sort').addEventListener('change', (e) => { state.noteSort = e.target.value; renderNotes(); });
$('#note-space-create-btn').addEventListener('click', () => openSpaceDialog('create'));
$('#note-space-manage-btn').addEventListener('click', () => openSpaceDialog('manage'));

// ---------- P3-M5：两列任务看板与日期区间映射 ----------
let editingTaskId = null;

function priorityLabel(priority) {
  return ({ high: '高优先级', normal: '普通', low: '低优先级' })[priority] || '普通';
}

function taskMatches(task) {
  const q = state.taskQ.trim().toLowerCase();
  return !q || `${task.title || ''}\n${task.notes || ''}`.toLowerCase().includes(q);
}

function renderTasks() {
  const active = state.tasks.filter((task) => task && task.completed !== true && taskMatches(task));
  const rangeTasks = active.filter((task) => task.kind === 'range')
    .sort((a, b) => ((b.priority === 'high') - (a.priority === 'high')) || String(a.endDate).localeCompare(String(b.endDate)));
  const todayTasks = active.filter((task) => (
    task.kind === 'today' ? task.date === state.selectedDate : shouldMapRangeTask(task, state.selectedDate)
  )).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  $('#range-task-count').textContent = String(rangeTasks.length);
  $('#today-task-count').textContent = String(todayTasks.length);
  renderTaskList($('#range-task-list'), rangeTasks, 'range', '暂时没有长期待办');
  renderTaskList($('#today-task-list'), todayTasks, 'today', '这一天没有安排');
  const mapped = todayTasks.filter((task) => task.kind === 'range').length;
  const [year, month, day] = state.selectedDate.split('-').map(Number);
  $('#schedule-summary').textContent = `${year} 年 ${month} 月 ${day} 日 · 今日显示 ${todayTasks.length} 项，其中 ${mapped} 项来自长期待办`;
  $('#task-selected-date').textContent = `${state.selectedDate === localIsoDate() ? '今天 · ' : ''}${month}月${day}日`;
}

function renderTaskList(list, tasks, context, emptyText) {
  list.textContent = '';
  if (tasks.length === 0) {
    list.appendChild(el('div', { class: 'column-empty' }, [
      el('span', { text: context === 'range' ? '＋' : '☾' }), el('p', { text: emptyText })
    ]));
    return;
  }
  tasks.forEach((task) => list.appendChild(taskCard(task, context)));
}

function taskCard(task, context) {
  const mappedRange = context === 'today' && task.kind === 'range';
  const originText = context === 'range' ? '长期事务' : mappedRange ? '来自长期待办' : '当日新增';
  const dateText = task.kind === 'range'
    ? `${shortIsoDate(task.startDate)} — ${shortIsoDate(task.endDate)}`
    : `${shortIsoDate(task.date)} · 当日`;
  const card = el('article', {
    class: `task-card priority-${task.priority}`, tabindex: '0', role: 'button',
    'aria-label': `编辑 ${task.title}`,
    onclick: () => openTaskDialog(task.id),
    onkeydown: (e) => { if (e.key === 'Enter') openTaskDialog(task.id); }
  });
  const complete = el('button', {
    type: 'button', class: 'complete-task', text: '✓ 完成',
    onclick: (e) => { e.stopPropagation(); completeTask(task.id); }
  });
  card.appendChild(el('div', { class: 'task-top' }, [
    el('div', null, [
      el('span', { class: `task-origin ${task.kind}`, text: originText }),
      el('span', { text: priorityLabel(task.priority) })
    ]),
    el('div', null, [complete, el('button', { type: 'button', text: '•••', 'aria-label': '编辑任务' })])
  ]));
  card.appendChild(el('h3', { text: task.title }));
  card.appendChild(el('p', { text: task.notes || '暂无备注' }));
  if (mappedRange) {
    card.appendChild(el('div', { class: 'range-progress' }, [
      el('i'), el('span', { text: task.priority === 'high' ? '高优先级 · 区间内同步' : '已进入任务最后一周' })
    ]));
  }
  const footerChildren = [];
  if (task.kind === 'today') footerChildren.push(el('span', { text: task.time ? `◷ ${task.time}` : '全天' }));
  footerChildren.push(el('span', { class: 'task-date-meta', text: dateText }));
  if (task.reminderId) footerChildren.push(el('span', { text: '◉ 已提醒' }));
  card.appendChild(el('footer', null, footerChildren));
  return card;
}

function updateTaskTimeState(enabled) {
  $('#task-time-enabled').checked = enabled;
  $('#task-time').disabled = !enabled;
  $('#task-time').closest('.optional-time-field').classList.toggle('enabled', enabled);
}

function updateTaskKind(kind) {
  $('#task-kind').value = kind;
  $('#task-range-fields').hidden = kind !== 'range';
  $('#task-today-fields').hidden = kind !== 'today';
  $('#task-dialog-title').textContent = `${editingTaskId ? '编辑' : '新建'}${kind === 'range' ? '长期待办' : '当日事项'}`;
  $('#task-dialog-subtitle').textContent = kind === 'range'
    ? '高优先级全程同步，其余仅在最后一周进入今日事项'
    : '记录当天临时事务，可按需启用具体时间';
}

function openTaskDialog(id, presetKind) {
  const task = id ? state.tasks.find((item) => item && item.id === id) : null;
  if (id && !task) { showToast('任务不存在'); return; }
  editingTaskId = task ? task.id : null;
  const kind = task ? task.kind : (presetKind === 'today' ? 'today' : 'range');
  $('#task-id').value = task ? task.id : '';
  $('#task-title').value = task ? task.title : '';
  $('#task-start-date').value = task && task.kind === 'range' ? task.startDate : state.selectedDate;
  $('#task-end-date').value = task && task.kind === 'range' ? task.endDate : addDays(state.selectedDate, 3);
  $('#task-date').value = task && task.kind === 'today' ? task.date : state.selectedDate;
  $('#task-time').value = task && task.time ? task.time : '10:30';
  updateTaskTimeState(Boolean(task && task.kind === 'today' && task.time));
  $('#task-priority').value = task ? task.priority : 'normal';
  $('#task-notes').value = task ? task.notes : '';
  $('#task-reminder').checked = Boolean(task && task.reminderId);
  $('#task-delete').hidden = !task;
  clearFieldError('task-title');
  updateTaskKind(kind);
  $('#task-dialog').showModal();
  $('#task-title').focus();
}

async function completeTask(id) {
  const res = await api.taskToggleComplete(id, true);
  if (handleResult(res)) showToast('事项已完成并从当前视图移除');
}

$('#task-form').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) { setFieldError('task-title', '请输入任务标题'); return; }
  const kind = $('#task-kind').value;
  const res = await api.taskSave({
    id: editingTaskId || '', kind, title,
    startDate: kind === 'range' ? $('#task-start-date').value : '',
    endDate: kind === 'range' ? $('#task-end-date').value : '',
    date: kind === 'today' ? $('#task-date').value : '',
    time: kind === 'today' && $('#task-time-enabled').checked ? $('#task-time').value : '',
    priority: $('#task-priority').value,
    notes: $('#task-notes').value,
    reminderEnabled: $('#task-reminder').checked
  });
  if (!handleResult(res)) return;
  $('#task-dialog').close();
  showToast(editingTaskId ? '任务已更新' : '任务已加入看板');
  editingTaskId = null;
});

$('#task-delete').addEventListener('click', async () => {
  const task = state.tasks.find((item) => item && item.id === editingTaskId);
  if (!task) return;
  $('#task-dialog').close();
  const answer = await confirmDialog(task.reminderId ? {
    title: '删除任务', subtitle: '该任务有关联提醒', message: `如何处理「${task.title}」的关联提醒？`,
    actions: [
      { label: '仅删除任务', kind: 'ghost', value: 'keep' },
      { label: '任务和提醒一起删除', kind: 'danger', value: 'delete' }
    ]
  } : {
    title: '删除任务', subtitle: '该操作不可撤销', message: `确定要删除「${task.title}」吗？`,
    actions: [{ label: '删除任务', kind: 'danger', value: 'delete' }]
  });
  if (!['keep', 'delete'].includes(answer)) { openTaskDialog(task.id); return; }
  const res = await api.taskDelete(task.id, task.reminderId ? answer : undefined);
  if (handleResult(res)) { editingTaskId = null; showToast(answer === 'delete' && task.reminderId ? '任务和提醒已删除' : '任务已删除'); }
});

$('#task-create-range').addEventListener('click', () => openTaskDialog(null, 'range'));
$('#task-quick-range').addEventListener('click', () => openTaskDialog(null, 'range'));
$('#task-quick-today').addEventListener('click', () => openTaskDialog(null, 'today'));
$('#task-time-enabled').addEventListener('change', (e) => updateTaskTimeState(e.target.checked));
$('#task-title').addEventListener('input', () => clearFieldError('task-title'));
$('#task-search').addEventListener('input', (e) => { state.taskQ = e.target.value; renderTasks(); });
document.querySelectorAll('[data-date-step]').forEach((button) => {
  button.addEventListener('click', () => { state.selectedDate = addDays(state.selectedDate, Number(button.dataset.dateStep)); renderTasks(); });
});
$('#task-selected-date').addEventListener('click', () => { state.selectedDate = localIsoDate(); renderTasks(); });

// ---------- P3-M6：月历、日期详情与提醒管理 ----------
let editingReminderId = null;

function showScheduleView(view) {
  if (!['board', 'calendar', 'reminders'].includes(view)) view = 'board';
  state.scheduleView = view;
  document.querySelectorAll('.schedule-view').forEach((node) => node.classList.toggle('active', node.id === `schedule-${view}`));
  document.querySelectorAll('.schedule-view-tabs [data-schedule-view]').forEach((button) => button.classList.toggle('active', button.dataset.scheduleView === view));
  const search = $('#task-search');
  search.disabled = view !== 'board';
  search.closest('.compact-search').classList.toggle('disabled', view !== 'board');
  if (view === 'board') renderTasks();
  if (view === 'calendar') buildCalendar();
  if (view === 'reminders') renderReminders();
}

function buildCalendar() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  $('#calendar-title').textContent = `${year} 年 ${month + 1} 月`;
  const first = new Date(year, month, 1, 12);
  const mondayIndex = (first.getDay() + 6) % 7;
  const firstCell = new Date(year, month, 1 - mondayIndex, 12);
  const grid = $('#calendar-grid');
  grid.textContent = '';
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    const iso = localIsoDate(date);
    grid.appendChild(el('button', {
      type: 'button',
      class: `calendar-day ${date.getMonth() !== month ? 'muted' : ''} ${iso === localIsoDate() ? 'today' : ''} ${iso === state.selectedDate ? 'selected' : ''}`,
      dataset: { date: iso },
      onclick: () => openDayPanel(iso)
    }, el('b', { text: String(date.getDate()) })));
  }
}

function dateInTask(task, date) {
  return task.kind === 'today'
    ? task.date === date
    : String(task.startDate) <= date && date <= String(task.endDate);
}

function openDayPanel(date) {
  state.selectedDate = date;
  const parsed = new Date(`${date}T12:00:00`);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  $('#day-panel-title').textContent = `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 · ${weekdays[parsed.getDay()]}`;
  const items = [
    ...state.tasks.filter((task) => task && !task.completed && dateInTask(task, date)).map((task) => ({
      kind: 'task', title: task.title,
      meta: task.kind === 'range' ? `区间 ${shortIsoDate(task.startDate)}—${shortIsoDate(task.endDate)}` : `${task.time || '全天'} · 当日事项`
    })),
    ...state.reminders.filter((reminder) => reminder && reminder.type === 'absolute' && reminder.date === date).map((reminder) => ({
      kind: 'reminder', title: reminder.text, meta: `${reminder.time} · 定点提醒${reminder.enabled ? '' : ' · 已停用'}`
    }))
  ];
  const list = $('#day-panel-list');
  list.textContent = '';
  if (items.length === 0) {
    list.appendChild(el('div', { class: 'day-empty' }, [el('span', { text: '☾' }), el('strong', { text: '当天没有安排' }), el('p', { text: '留一点空白，也是一种节奏。' })]));
  } else {
    items.forEach((item) => list.appendChild(el('article', null, [
      el('span', { class: `day-item-icon ${item.kind}`, text: item.kind === 'task' ? '✓' : '◷' }),
      el('div', null, [el('strong', { text: item.title }), el('small', { text: item.meta })])
    ])));
  }
  $('.calendar-layout').classList.add('day-open');
  buildCalendar();
  renderTasks();
}

function reminderMeta(reminder) {
  if (reminder.type === 'absolute') return reminder.date ? `${reminder.date} ${reminder.time} · 显示在月历` : `每天 ${reminder.time} · 旧版提醒`;
  if (reminder.type === 'usage' || reminder.preset === 'usage') return `从应用启动时累计 · ${reminder.intervalMin} 分钟`;
  return `每 ${reminder.intervalMin} 分钟提醒一次`;
}

function renderReminders() {
  const names = { absolute: '定点提醒', interval: '周期提醒', usage: '使用时长' };
  const tones = { absolute: 'pink', interval: 'cyan', usage: 'gold' };
  const icons = { absolute: '◉', interval: '◷', usage: '⌁' };
  $('#reminder-enabled-count').textContent = String(state.reminders.filter((item) => item && item.enabled).length);
  const list = $('#reminder-list');
  list.textContent = '';
  if (state.reminders.length === 0) {
    list.appendChild(el('div', { class: 'day-empty' }, [el('strong', { text: '还没有提醒' }), el('p', { text: '新增一个提醒，交给桌宠准时告诉你。' })]));
    return;
  }
  state.reminders.filter(Boolean).forEach((reminder) => {
    const displayType = reminder.preset === 'usage' ? 'usage' : reminder.type;
    const toggle = el('input', { type: 'checkbox' });
    toggle.checked = reminder.enabled !== false;
    toggle.addEventListener('change', async () => handleResult(await api.workspaceReminderToggle(reminder.id, toggle.checked)));
    list.appendChild(el('article', null, [
      el('span', { class: `reminder-icon ${tones[displayType] || 'cyan'}`, text: icons[displayType] || '◷' }),
      el('div', null, [
        el('span', { class: 'reminder-type', text: names[displayType] || '提醒' }),
        reminder.linkedTaskId ? el('span', { class: 'linked-badge', text: '已关联任务' }) : null,
        el('h3', { text: reminder.text || '未命名提醒' }), el('p', { text: reminderMeta(reminder) })
      ]),
      el('label', { class: 'switch' }, [toggle, el('i')]),
      el('button', { type: 'button', text: '•••', 'aria-label': '编辑提醒', onclick: () => openReminderDialog(reminder.id) })
    ]));
  });
}

function updateReminderFields() {
  const type = $('#reminder-type').value;
  const linked = Boolean(state.reminders.find((item) => item && item.id === editingReminderId && item.linkedTaskId));
  $('#reminder-type').disabled = linked;
  $('#reminder-linked-hint').hidden = !linked;
  $('#reminder-date-field').hidden = type !== 'absolute';
  $('#reminder-value-label').textContent = type === 'absolute' ? '提醒时间' : type === 'interval' ? '间隔分钟' : '累计分钟';
  const value = $('#reminder-value');
  value.type = type === 'absolute' ? 'time' : 'number';
  value.min = type === 'absolute' ? '' : '1';
  value.max = type === 'absolute' ? '' : '10080';
  if (type !== 'absolute' && String(value.value).includes(':')) value.value = type === 'usage' ? '60' : '50';
}

function openReminderDialog(id) {
  const reminder = id ? state.reminders.find((item) => item && item.id === id) : null;
  if (id && !reminder) return showToast('提醒不存在');
  editingReminderId = reminder ? reminder.id : null;
  $('#reminder-dialog-title').textContent = reminder ? '编辑提醒' : '新增提醒';
  $('#reminder-id').value = reminder ? reminder.id : '';
  $('#reminder-text').value = reminder ? reminder.text : '';
  $('#reminder-type').value = reminder ? (reminder.preset === 'usage' ? 'usage' : reminder.type) : 'absolute';
  $('#reminder-date').value = reminder && reminder.date ? reminder.date : state.selectedDate;
  $('#reminder-value').value = reminder ? (reminder.type === 'absolute' ? reminder.time : reminder.intervalMin) : '16:30';
  $('#reminder-enabled').checked = reminder ? reminder.enabled !== false : true;
  $('#reminder-delete').hidden = !reminder;
  clearFieldError('reminder-text');
  updateReminderFields();
  $('#reminder-dialog').showModal();
}

function renderSchedule() {
  renderTasks();
  buildCalendar();
  renderReminders();
}

document.querySelectorAll('[data-schedule-view]').forEach((button) => button.addEventListener('click', () => showScheduleView(button.dataset.scheduleView)));
document.querySelectorAll('[data-month-step]').forEach((button) => button.addEventListener('click', () => {
  state.calendarMonth += Number(button.dataset.monthStep);
  if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  buildCalendar();
}));
$('#day-panel-close').addEventListener('click', () => $('.calendar-layout').classList.remove('day-open'));
$('#day-task-create').addEventListener('click', () => openTaskDialog(null, 'today'));
$('#reminder-create').addEventListener('click', () => openReminderDialog());
$('#reminder-type').addEventListener('change', updateReminderFields);
$('#reminder-text').addEventListener('input', () => clearFieldError('reminder-text'));
$('#reminder-form').addEventListener('submit', async (event) => {
  if (event.submitter && event.submitter.value === 'cancel') return;
  event.preventDefault();
  const text = $('#reminder-text').value.trim();
  if (!text) return setFieldError('reminder-text', '请输入提醒内容');
  const type = $('#reminder-type').value;
  const res = await api.workspaceReminderSave({
    id: editingReminderId || '', type, text, enabled: $('#reminder-enabled').checked,
    date: type === 'absolute' ? $('#reminder-date').value : '',
    time: type === 'absolute' ? $('#reminder-value').value : '',
    intervalMin: type === 'absolute' ? '' : $('#reminder-value').value
  });
  if (!handleResult(res)) return;
  $('#reminder-dialog').close();
  showToast(editingReminderId ? '提醒已更新' : '提醒已创建');
  editingReminderId = null;
});
$('#reminder-delete').addEventListener('click', async () => {
  const reminder = state.reminders.find((item) => item && item.id === editingReminderId);
  if (!reminder) return;
  $('#reminder-dialog').close();
  const answer = await confirmDialog({
    title: '删除提醒', subtitle: reminder.linkedTaskId ? '关联任务会保留' : '该操作不可撤销',
    message: reminder.linkedTaskId ? '删除后，关联任务将不再到点提醒。' : `确定删除「${reminder.text}」吗？`,
    actions: [{ label: '删除提醒', kind: 'danger', value: 'ok' }]
  });
  if (answer !== 'ok') { openReminderDialog(reminder.id); return; }
  const res = await api.workspaceReminderDelete(reminder.id);
  if (handleResult(res)) { editingReminderId = null; showToast('提醒已删除'); }
});

// ---------- P3-M7：完整设置页 ----------
let volumeSaveTimer = null;

function setSettingsSaveState(text, tone) {
  const node = $('#settings-save-state');
  node.classList.toggle('saving', tone === 'saving');
  node.classList.toggle('error', tone === 'error');
  node.lastChild.textContent = text;
}

function renderGeneralSettings() {
  const settings = state.settings || {};
  $('#setting-default-page').value = ['notes', 'prompts'].includes(settings.defaultPage) ? settings.defaultPage : 'prompts';
  $('#setting-always-top').checked = settings.alwaysOnTop !== false;
  $('#setting-launch-login').checked = settings.launchAtLogin === true;
  const volume = Math.round(Math.max(0, Math.min(1, Number(settings.volume) || 0)) * 100);
  $('#setting-volume').value = String(volume);
  $('#setting-volume-value').textContent = `${volume}%`;
  $('#setting-reduced-motion').checked = settings.reducedMotion === true;
  document.body.classList.toggle('reduce-motion', settings.reducedMotion === true);
  $('#setting-data-path').textContent = state.dataPath || '未获取到数据目录';
  $('#setting-app-version').textContent = `AI 桌宠 · 版本 ${state.version || '—'}`;
}

function renderModelSettings() {
  const chat = (state.settings && state.settings.chat) || {};
  $('#setting-model-endpoint').value = chat.baseUrl || '';
  $('#setting-model-name').value = chat.model || '';
  $('#setting-model-persona').value = chat.systemPrompt || '';
  $('#setting-model-key').value = '';
  $('#setting-key-state').textContent = chat.storedApiKeyConfigured ? '已保存' : chat.apiKeyConfigured ? '.env 已配置' : '未配置';
  $('#setting-clear-key').disabled = !chat.storedApiKeyConfigured;
  $('#model-config-status').lastChild.textContent = chat.apiKeyConfigured ? 'Key 已配置 · 下一条消息生效' : '尚未配置 API Key';
  $('#setting-env-path').textContent = state.envFile
    ? `.env 配置位置：${state.envFile}。页面保存值优先，Key 保存后不会回显。`
    : '未检测到 .env；可在本页保存配置，Key 保存后不会回显。';
}

function renderSettings() {
  renderGeneralSettings();
  renderModelSettings();
}

async function saveGeneralSettings(patch) {
  setSettingsSaveState('正在保存…', 'saving');
  const res = await api.workspaceSettingsSave(patch);
  if (!res || res.ok !== true) {
    setSettingsSaveState((res && res.error) || '保存失败', 'error');
    showToast((res && res.error) || '设置保存失败');
    renderGeneralSettings();
    return false;
  }
  state.settings = res.settings || state.settings;
  renderGeneralSettings();
  setSettingsSaveState('所有更改已保存');
  return true;
}

$('#setting-default-page').addEventListener('change', async (event) => {
  const page = event.target.value;
  if (await saveGeneralSettings({ defaultPage: page })) {
    showToast(`默认打开界面已设为「${page === 'notes' ? '记事本' : '提示词管理工具'}」`);
    showPage(page);
  }
});
$('#setting-always-top').addEventListener('change', (event) => saveGeneralSettings({ alwaysOnTop: event.target.checked }));
$('#setting-launch-login').addEventListener('change', (event) => saveGeneralSettings({ launchAtLogin: event.target.checked }));
$('#setting-reduced-motion').addEventListener('change', (event) => saveGeneralSettings({ reducedMotion: event.target.checked }));
$('#setting-volume').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  $('#setting-volume-value').textContent = `${value}%`;
  setSettingsSaveState('正在保存…', 'saving');
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => {
    volumeSaveTimer = null;
    saveGeneralSettings({ volume: value / 100 });
  }, 280);
});
$('#setting-copy-data-path').addEventListener('click', async () => {
  if (!state.dataPath) return showToast('暂未获取到数据目录');
  await api.copyText(state.dataPath);
  showToast('数据存储路径已复制');
});

$('#setting-model-save').addEventListener('click', async () => {
  setSettingsSaveState('正在保存…', 'saving');
  const res = await api.chatSetConfig({
    apiKey: $('#setting-model-key').value.trim(),
    baseUrl: $('#setting-model-endpoint').value.trim(),
    model: $('#setting-model-name').value,
    systemPrompt: $('#setting-model-persona').value.trim()
  });
  if (!res || res.ok !== true) {
    setSettingsSaveState((res && res.error) || '保存失败', 'error');
    return showToast((res && res.error) || '大模型配置保存失败');
  }
  await loadWorkspaceSettings();
  setSettingsSaveState('所有更改已保存');
  showToast('大模型配置已保存，下一条消息生效');
});

$('#setting-clear-key').addEventListener('click', async () => {
  const answer = await confirmDialog({
    title: '清除已保存的 API Key', subtitle: '.env 中的 Key 不受影响',
    message: '确认清除本页保存的 API Key 吗？清除后若存在 .env Key，会自动回退使用。',
    actions: [{ label: '清除 Key', kind: 'danger', value: 'ok' }]
  });
  if (answer !== 'ok') return;
  const res = await api.chatSetConfig({
    clearApiKey: true,
    baseUrl: $('#setting-model-endpoint').value.trim(),
    model: $('#setting-model-name').value,
    systemPrompt: $('#setting-model-persona').value.trim()
  });
  if (!res || res.ok !== true) return showToast((res && res.error) || '清除失败');
  await loadWorkspaceSettings();
  showToast('已清除本页保存的 API Key');
});

$('#setting-clear-history').addEventListener('click', async () => {
  const answer = await confirmDialog({
    title: '清空对话历史', subtitle: '该操作不可撤销', message: '历史消息与压缩摘要都会被清除。',
    actions: [{ label: '清空历史', kind: 'danger', value: 'ok' }]
  });
  if (answer !== 'ok') return;
  await api.chatClearHistory();
  showToast('对话历史已清空');
});

$('#setting-exit-app').addEventListener('click', async () => {
  const answer = await confirmDialog({
    title: '退出 AI 桌宠', subtitle: '工作台与桌宠都会关闭', message: '确认退出应用吗？',
    actions: [{ label: '退出应用', kind: 'danger', value: 'ok' }]
  });
  if (answer === 'ok') api.quit();
});

// ---------- P3-M2：项目空间管理模态框 ----------
let spaceDialogMode = 'create'; // create | manage
let spaceRenameId = null;

function openSpaceDialog(mode) {
  spaceDialogMode = mode;
  spaceRenameId = null;
  $('#space-dialog-title').textContent = mode === 'create' ? '新建项目空间' : '管理项目空间';
  $('#space-name').value = '';
  clearFieldError('space-name');
  $('#space-save').textContent = mode === 'create' ? '保存空间' : '确认重命名';
  $('#space-manager').hidden = mode !== 'manage';
  if (mode === 'manage') renderSpaceManager();
  $('#space-dialog').showModal();
}

$('#space-create-btn').addEventListener('click', () => openSpaceDialog('create'));
$('#space-manage-btn').addEventListener('click', () => openSpaceDialog('manage'));
$('#space-name').addEventListener('input', () => clearFieldError('space-name'));

// 管理模式列表：每个空间一行（图标 + 名称/数量 + 上移/下移/重命名/删除）
function renderSpaceManager() {
  const list = $('#space-manager-list');
  list.textContent = '';
  state.spaces.forEach((s, i) => {
    const entryCount = countIn(s.id);
    const notesCount = noteCountIn(s.id);
    const count = totalCountIn(s.id);
    const isDefault = s.id === state.defaultSpaceId;
    list.appendChild(el('div', { class: 'manager-row' }, [
      el('span', { class: `space-glyph ${GLYPHS[(i + 1) % GLYPHS.length]}`, text: s.name.trim().charAt(0) || '·' }),
      el('div', null, [
        el('strong', { text: s.name }),
        el('small', { text: `${isDefault ? '默认空间 · ' : ''}${entryCount} 条内容 · ${notesCount} 条笔记` })
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', {
          type: 'button', text: '↑', title: '上移',
          disabled: i === 0 ? '' : null,
          onclick: () => moveSpace(s.id, 'up')
        }),
        el('button', {
          type: 'button', text: '↓', title: '下移',
          disabled: i === state.spaces.length - 1 ? '' : null,
          onclick: () => moveSpace(s.id, 'down')
        }),
        el('button', {
          type: 'button', text: '重命名',
          onclick: () => {
            spaceRenameId = s.id;
            $('#space-name').value = s.name;
            $('#space-name').focus();
          }
        }),
        el('button', {
          type: 'button', text: '删除',
          disabled: isDefault ? '' : null,
          title: isDefault ? '默认空间不可删除' : '删除空间',
          onclick: () => deleteSpaceFlow(s, count)
        })
      ])
    ]));
  });
  if (state.spaces.length === 0) {
    list.appendChild(el('p', { text: '暂无空间', style: 'color:#939ca1;font-size:11px;margin:6px 0' }));
  }
}

async function moveSpace(id, direction) {
  const res = await api.spaceMove(id, direction);
  if (handleResult(res)) renderSpaceManager();
}

// 删除空间两分支：空空间直接确认删除；非空选择「迁移到默认空间」或「一并删除」
async function deleteSpaceFlow(space, count) {
  if (space.id === state.defaultSpaceId) { showToast('默认空间不可删除'); return; }
  if (count === 0) {
    const answer = await confirmDialog({
      title: '删除项目空间',
      subtitle: '该空间当前为空',
      message: `确定要删除空空间「${space.name}」吗？`,
      actions: [{ label: '删除空间', kind: 'danger', value: 'ok' }]
    });
    if (answer !== 'ok') return;
    const res = await api.spaceDelete(space.id);
    if (handleResult(res)) { showToast('空间已删除'); renderSpaceManager(); }
    return;
  }
  const answer = await confirmDialog({
    title: '删除项目空间',
    subtitle: `空间内还有 ${count} 条内容`,
    message: `「${space.name}」内有 ${count} 条内容。请选择处理方式：迁移到默认空间（保留内容），或连同内容一起删除（不可恢复）。`,
    actions: [
      { label: '迁移到默认空间', kind: 'primary', value: 'migrate' },
      { label: '一并删除', kind: 'danger', value: 'purge' }
    ]
  });
  if (answer !== 'migrate' && answer !== 'purge') return;
  const res = await api.spaceDelete(space.id, answer);
  if (handleResult(res)) {
    showToast(answer === 'migrate' ? '内容已迁移到默认空间' : '空间与内容已删除');
    renderSpaceManager();
  }
}

// 模态框提交（method=dialog 需拦截做校验与 IPC，成功后手动关闭）
$('#space-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#space-name').value.trim();
  if (!name) { setFieldError('space-name', '请输入空间名称'); return; }
  if (spaceDialogMode === 'create') {
    const res = await api.spaceCreate(name);
    if (handleResult(res)) { $('#space-dialog').close(); showToast('空间已创建'); }
  } else {
    if (!spaceRenameId) { setFieldError('space-name', '请先点击列表中的「重命名」'); return; }
    const res = await api.spaceRename(spaceRenameId, name);
    if (handleResult(res)) { $('#space-dialog').close(); showToast('空间已重命名'); }
  }
});

// ---------- 通用确认弹窗（promise 化：resolve 按钮值，取消/Esc 返回 null） ----------
function confirmDialog({ title, subtitle, message, actions }) {
  return new Promise((resolve) => {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title || '确认操作';
    $('#confirm-subtitle').textContent = subtitle || '请确认是否继续';
    $('#confirm-message').textContent = message || '';
    const box = $('#confirm-actions');
    box.textContent = '';
    (actions || []).forEach((a) => {
      box.appendChild(el('button', {
        type: 'submit',
        value: a.value,
        class: a.kind === 'danger' ? 'danger-button' : a.kind === 'primary' ? 'primary-button' : 'ghost-button',
        text: a.label
      }));
    });
    const onclose = () => {
      dlg.removeEventListener('close', onclose);
      resolve(dlg.returnValue || null);
    };
    dlg.addEventListener('close', onclose);
    dlg.showModal();
  });
}

// ---------- toast ----------
let toastTimer = null;
function showToast(message) {
  $('#toast-message').textContent = message;
  const t = $('#toast');
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 全局键盘 ----------
document.addEventListener('keydown', (e) => {
  // Ctrl/Win + K：聚焦搜索框（提示词页内常用快捷检索）
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    $('#prompt-search').focus();
    return;
  }
  // Esc：关闭打开中的抽屉
  if (e.key === 'Escape' && $('#entry-drawer').classList.contains('open')) {
    closeDrawer();
  }
});

// ---------- 跨窗口数据同步（宠物窗口变更 entries 时刷新） ----------
api.onDataChanged(() => { reload(); loadWorkspaceSettings(); });

// ---------- 初始化：按默认页打开 + 拉取内容与设置 ----------
(async function init() {
  const init = await api.workspaceGetInit();
  showPage(init.page);
  await Promise.all([reload(), loadWorkspaceSettings()]);
})();
