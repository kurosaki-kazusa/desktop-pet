// workspace.js · 工作台渲染层
// P3-M1：四项顶部导航路由 + 自定义标题栏窗口控制
// P3-M2/M3：提示词管理工具 —— 项目空间 / 双形态卡片 / 详情抽屉 / 封面管理
// 安全约定与 renderer.js 一致：用户输入一律 createElement + textContent 渲染，禁止 innerHTML 拼接

const $ = (sel) => document.querySelector(sel);
const api = window.petAPI;

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
  defaultSpaceId: '',
  spaceId: null, // null = 全部内容
  filter: 'all', // all | prompt | command
  sort: 'pinned', // pinned | updated | title
  q: ''
};

async function reload() {
  const data = await api.workspaceGetData();
  applyData(data);
}

// 应用最新数据（拉取与 CRUD 响应共用）：当前空间被删时回退到「全部内容」
function applyData(data) {
  state.spaces = (data && data.spaces) || [];
  state.entries = (data && data.entries) || [];
  state.defaultSpaceId = (data && data.defaultSpaceId) || '';
  if (state.spaceId && !state.spaces.some((s) => s.id === state.spaceId)) state.spaceId = null;
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

// ---------- P3-M2：渲染 ----------
function render() {
  renderHeader();
  renderSpaces();
  renderCards();
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
    const count = countIn(s.id);
    const isDefault = s.id === state.defaultSpaceId;
    list.appendChild(el('div', { class: 'manager-row' }, [
      el('span', { class: `space-glyph ${GLYPHS[(i + 1) % GLYPHS.length]}`, text: s.name.trim().charAt(0) || '·' }),
      el('div', null, [
        el('strong', { text: s.name }),
        el('small', { text: isDefault ? `默认空间 · ${count} 条` : `${count} 条内容` })
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
api.onDataChanged(() => { reload(); });

// ---------- 初始化：恢复上次停留页面 + 拉取空间与条目数据 ----------
(async function init() {
  const init = await api.workspaceGetInit();
  showPage(init.page);
  await reload();
})();
