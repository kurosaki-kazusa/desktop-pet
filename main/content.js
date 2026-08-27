// main/content.js · P3-M2/M3：项目空间、统一内容模型与封面管理
// 职责：空间 CRUD（重名校验/排序/删除两分支）、entry CRUD（type: prompt|command）、
// 工作台数据拉取。所有变更返回最新 { spaces, entries } 并广播 data:changed（宠物窗口同步）。
// P3-M3：coverId 支持 none / character / poster / 本地图片 data URL，并提供原生图片复制。

const { ipcMain, BrowserWindow, clipboard, nativeImage } = require('electron');
const path = require('path');
const { DEFAULT_SPACE_ID } = require('./storage');

const SPACE_NAME_MAX = 16;
const ENTRY_TITLE_MAX = 60;
const ENTRY_CONTENT_MAX = 2000;
const ENTRY_TYPES = ['prompt', 'command'];
const COVER_IDS = ['none', 'character', 'poster'];
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_COVER_DATA_URL_LENGTH = Math.ceil(MAX_COVER_BYTES * 4 / 3) + 128;

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

// 空间按 order 升序（order 相同时保持数组顺序，写入时统一重排保证唯一）
function getSpaces(store) {
  const raw = store.get('spaces');
  const spaces = (Array.isArray(raw) ? raw : []).filter((s) => s && typeof s.id === 'string' && s.id);
  return spaces
    .map((s, i) => ({ ...s, order: Number(s.order) || i }))
    .sort((a, b) => a.order - b.order);
}

function getEntries(store) {
  const raw = store.get('entries');
  return Array.isArray(raw) ? raw : [];
}

function snapshot(store) {
  // defaultSpaceId：渲染层据此识别默认空间（默认空间禁删，非空删除时作为迁移目标）
  return { spaces: getSpaces(store), entries: getEntries(store), defaultSpaceId: DEFAULT_SPACE_ID };
}

// 数据变更广播（排除发起者；宠物窗口 command:* 数据源同为 entries，需同步刷新）
function broadcast(sender) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w && !w.isDestroyed() && w !== sender) w.webContents.send('data:changed');
  });
}

// 校验空间名称：非空、长度上限、重名拦截（trim 后精确比较）
function checkSpaceName(spaces, name, excludeId) {
  if (!name) return '请输入空间名称';
  if (name.length > SPACE_NAME_MAX) return `空间名称不能超过 ${SPACE_NAME_MAX} 个字符`;
  if (spaces.some((s) => s.id !== excludeId && s.name === name)) return '已存在同名空间';
  return '';
}

// 校验条目字段：类型白名单、空间存在、标题/正文非空与长度
function checkEntry(spaces, e) {
  if (!e || ENTRY_TYPES.indexOf(e.type) < 0) return '内容类型无效';
  if (!spaces.some((s) => s.id === e.spaceId)) return '项目空间无效';
  const title = String((e && e.title) || '').trim();
  const content = String((e && e.content) || '');
  if (!title) return '请输入标题';
  if (title.length > ENTRY_TITLE_MAX) return `标题不能超过 ${ENTRY_TITLE_MAX} 个字符`;
  if (!content.trim()) return '请输入正文';
  if (content.length > ENTRY_CONTENT_MAX) return `正文不能超过 ${ENTRY_CONTENT_MAX} 个字符`;
  return '';
}

function normalizeCoverId(value) {
  const coverId = value == null || value === '' ? 'none' : String(value);
  if (COVER_IDS.includes(coverId)) return { value: coverId };
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(coverId)) {
    return { error: '卡片封面格式无效' };
  }
  if (coverId.length > MAX_COVER_DATA_URL_LENGTH) return { error: '卡片封面不能超过 5MB' };
  return { value: coverId };
}

function imageForCover(coverId) {
  if (coverId.startsWith('data:')) return nativeImage.createFromDataURL(coverId);
  const relative = coverId === 'character'
    ? ['assets', 'chat-avatar.png']
    : ['assets', 'ui-theme', 'firefly', 'backgrounds', 'chat-night.png'];
  return nativeImage.createFromPath(path.join(__dirname, '..', ...relative));
}

function init(store) {
  // 工作台数据拉取（spaces 已按 order 排序）
  ipcMain.handle('workspace:get-data', () => snapshot(store));

  // ---------- 空间管理 ----------
  ipcMain.handle('space:create', (e, data) => {
    const spaces = getSpaces(store);
    const name = String((data && data.name) || '').trim();
    const problem = checkSpaceName(spaces, name);
    if (problem) return { ok: false, error: problem };
    const order = spaces.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    store.set('spaces', [...spaces, { id: uid('space'), name, order, createdAt: Date.now() }]);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('space:rename', (e, data) => {
    const spaces = getSpaces(store);
    const id = String((data && data.id) || '');
    const target = spaces.find((s) => s.id === id);
    if (!target) return { ok: false, error: '空间不存在' };
    const name = String((data && data.name) || '').trim();
    const problem = checkSpaceName(spaces, name, id);
    if (problem) return { ok: false, error: problem };
    store.set('spaces', spaces.map((s) => (s.id === id ? { ...s, name } : s)));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // 拖动排序以 ↑/↓ 按钮承载（与原型一致）：与相邻空间交换位置后统一重写 order
  ipcMain.handle('space:move', (e, data) => {
    const spaces = getSpaces(store);
    const id = String((data && data.id) || '');
    const dir = data && data.direction === 'down' ? 1 : -1;
    const index = spaces.findIndex((s) => s.id === id);
    if (index < 0) return { ok: false, error: '空间不存在' };
    const target = index + dir;
    if (target < 0 || target >= spaces.length) return { ok: true, ...snapshot(store) };
    const next = spaces.slice();
    [next[index], next[target]] = [next[target], next[index]];
    store.set('spaces', next.map((s, i) => ({ ...s, order: i })));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // 删除空间：空空间直接删；非空必须选择 strategy（migrate=内容迁移到默认空间 / purge=一并删除）
  ipcMain.handle('space:delete', (e, data) => {
    const spaces = getSpaces(store);
    const entries = getEntries(store);
    const id = String((data && data.id) || '');
    if (id === DEFAULT_SPACE_ID) {
      return { ok: false, error: '默认空间不可删除（其他空间删除时内容会迁移到这里）' };
    }
    if (!spaces.some((s) => s.id === id)) return { ok: false, error: '空间不存在' };
    if (spaces.length <= 1) return { ok: false, error: '至少保留一个项目空间' };
    const affected = entries.filter((en) => en.spaceId === id).length;
    if (affected > 0) {
      const strategy = data && data.strategy;
      if (strategy === 'purge') {
        store.set('entries', entries.filter((en) => en.spaceId !== id));
      } else if (strategy === 'migrate') {
        // 系统性搬移不改 updatedAt，避免影响「最近更新」排序语义
        store.set('entries', entries.map((en) => (en.spaceId === id ? { ...en, spaceId: DEFAULT_SPACE_ID } : en)));
      } else {
        return { ok: false, error: '该空间内还有内容，请选择迁移或一并删除' };
      }
    }
    const rest = spaces.filter((s) => s.id !== id);
    store.set('spaces', rest.map((s, i) => ({ ...s, order: i })));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // ---------- 条目管理 ----------
  // 新建/编辑统一入口：id 为空即新建；更新时保留 createdAt/coverId 等既有字段
  ipcMain.handle('entry:save', (e, data) => {
    const spaces = getSpaces(store);
    const entries = getEntries(store);
    const d = data || {};
    const problem = checkEntry(spaces, d);
    if (problem) return { ok: false, error: problem };
    const cover = normalizeCoverId(d.coverId);
    if (cover.error) return { ok: false, error: cover.error };
    const now = Date.now();
    const patch = {
      type: d.type,
      spaceId: d.spaceId,
      title: String(d.title).trim(),
      content: String(d.content),
      pinned: d.pinned === true,
      coverId: cover.value
    };
    if (d.id) {
      const index = entries.findIndex((en) => en && en.id === d.id);
      if (index < 0) return { ok: false, error: '内容不存在' };
      entries[index] = { ...entries[index], ...patch, updatedAt: now };
      store.set('entries', entries);
    } else {
      entries.push({
        id: uid('entry'),
        ...patch,
        createdAt: now,
        updatedAt: now
      });
      store.set('entries', entries);
    }
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('entry:delete', (e, id) => {
    const idStr = String(id || '');
    store.set('entries', getEntries(store).filter((en) => !en || en.id !== idStr));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // 图片复制只接受已校验的封面标识；文件路径由主进程固定映射，不接收渲染层路径。
  ipcMain.handle('entry:copy-cover', (e, value) => {
    const cover = normalizeCoverId(value);
    if (cover.error || cover.value === 'none') return { ok: false, error: cover.error || '该卡片没有图片' };
    try {
      const image = imageForCover(cover.value);
      if (image.isEmpty()) return { ok: false, error: '封面图片无法读取' };
      clipboard.writeImage(image);
      return { ok: true };
    } catch {
      return { ok: false, error: '复制图片失败' };
    }
  });
}

module.exports = { init };
