// main/content.js · P3-M2~M6：项目空间、内容模型、封面、记事本、任务与提醒
// 职责：space / entry / note / task / reminder CRUD 与工作台数据拉取。
// P3-M3：coverId 支持 none / character / poster / 本地图片 data URL，并提供原生图片复制。

const { ipcMain, BrowserWindow, clipboard, nativeImage } = require('electron');
const path = require('path');
const { DEFAULT_SPACE_ID } = require('./storage');
const { dayNumber, isIsoDate } = require('../task-rules');

const SPACE_NAME_MAX = 16;
const ENTRY_TITLE_MAX = 60;
const ENTRY_CONTENT_MAX = 2000;
const ENTRY_TYPES = ['prompt', 'command'];
const COVER_IDS = ['none', 'character', 'poster'];
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_COVER_DATA_URL_LENGTH = Math.ceil(MAX_COVER_BYTES * 4 / 3) + 128;
const NOTE_TITLE_MAX = 60;
const NOTE_CONTENT_MAX = 100000;
const TASK_TITLE_MAX = 60;
const TASK_NOTES_MAX = 2000;
const TASK_KINDS = ['range', 'today'];
const TASK_PRIORITIES = ['high', 'normal', 'low'];
const REMINDER_TYPES = ['absolute', 'interval', 'usage'];
const REMINDER_TEXT_MAX = 80;

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

function getNotes(store) {
  const raw = store.get('notes');
  return Array.isArray(raw) ? raw : [];
}

function getTasks(store) {
  const raw = store.get('tasks');
  return Array.isArray(raw) ? raw : [];
}

function getReminders(store) {
  const raw = store.get('reminders');
  return Array.isArray(raw) ? raw : [];
}

function snapshot(store) {
  // defaultSpaceId：渲染层据此识别默认空间（默认空间禁删，非空删除时作为迁移目标）
  return { spaces: getSpaces(store), entries: getEntries(store), notes: getNotes(store), tasks: getTasks(store), reminders: getReminders(store), defaultSpaceId: DEFAULT_SPACE_ID };
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

function normalizeTask(data, existing) {
  const d = data || {};
  const kind = existing ? existing.kind : d.kind;
  if (!TASK_KINDS.includes(kind)) return { error: '任务类型无效' };
  if (existing && d.kind && d.kind !== existing.kind) return { error: '任务类型不可修改' };
  const title = String(d.title || '').trim();
  const notes = String(d.notes || '');
  const priority = TASK_PRIORITIES.includes(d.priority) ? d.priority : 'normal';
  if (!title) return { error: '请输入任务标题' };
  if (title.length > TASK_TITLE_MAX) return { error: `任务标题不能超过 ${TASK_TITLE_MAX} 个字符` };
  if (notes.length > TASK_NOTES_MAX) return { error: `任务备注不能超过 ${TASK_NOTES_MAX} 个字符` };
  const result = { kind, title, notes, priority };
  if (kind === 'range') {
    const startDate = String(d.startDate || '');
    const endDate = String(d.endDate || '');
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { error: '请选择有效的开始与结束日期' };
    if (dayNumber(startDate) > dayNumber(endDate)) return { error: '结束日期不能早于开始日期' };
    result.startDate = startDate;
    result.endDate = endDate;
    result.date = '';
    result.time = '';
  } else {
    const date = String(d.date || '');
    const time = String(d.time || '');
    if (!isIsoDate(date)) return { error: '请选择有效的事项日期' };
    if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: '事项时间无效' };
    result.date = date;
    result.time = time;
    result.startDate = '';
    result.endDate = '';
  }
  return { value: result };
}

function normalizeReminder(data, existing) {
  const d = data || {};
  const linked = existing && existing.linkedTaskId;
  const type = linked ? 'absolute' : (REMINDER_TYPES.includes(d.type) ? d.type : 'absolute');
  const text = String(d.text || '').trim();
  if (!text) return { error: '请输入提醒内容' };
  if (text.length > REMINDER_TEXT_MAX) return { error: `提醒内容不能超过 ${REMINDER_TEXT_MAX} 个字符` };
  const value = { type, text, enabled: d.enabled !== false, linkedTaskId: linked || null };
  if (existing && existing.preset) value.preset = existing.preset;
  if (type === 'absolute') {
    const date = String(d.date || '');
    const time = String(d.time || '');
    if (!isIsoDate(date)) return { error: '请选择有效的提醒日期' };
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: '请选择有效的提醒时间' };
    value.date = date;
    value.time = time;
  } else {
    const intervalMin = Math.round(Number(d.intervalMin));
    if (!Number.isFinite(intervalMin) || intervalMin < 1 || intervalMin > 10080) return { error: '提醒分钟数须为 1 到 10080' };
    value.intervalMin = intervalMin;
  }
  return { value };
}

function init(store, options = {}) {
  const reminderChanged = (id) => {
    if (typeof options.onReminderChanged === 'function') options.onReminderChanged(id);
  };
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
    const notes = getNotes(store);
    const id = String((data && data.id) || '');
    if (id === DEFAULT_SPACE_ID) {
      return { ok: false, error: '默认空间不可删除（其他空间删除时内容会迁移到这里）' };
    }
    if (!spaces.some((s) => s.id === id)) return { ok: false, error: '空间不存在' };
    if (spaces.length <= 1) return { ok: false, error: '至少保留一个项目空间' };
    const affected = entries.filter((en) => en.spaceId === id).length + notes.filter((note) => note.spaceId === id).length;
    if (affected > 0) {
      const strategy = data && data.strategy;
      if (strategy === 'purge') {
        store.set('entries', entries.filter((en) => en.spaceId !== id));
        store.set('notes', notes.filter((note) => note.spaceId !== id));
      } else if (strategy === 'migrate') {
        // 系统性搬移不改 updatedAt，避免影响「最近更新」排序语义
        store.set('entries', entries.map((en) => (en.spaceId === id ? { ...en, spaceId: DEFAULT_SPACE_ID } : en)));
        store.set('notes', notes.map((note) => (note.spaceId === id ? { ...note, spaceId: DEFAULT_SPACE_ID } : note)));
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

  // ---------- P3-M4：记事本（零配置创建、即时自动保存、删除） ----------
  ipcMain.handle('note:create', (e, data) => {
    const spaces = getSpaces(store);
    if (spaces.length === 0) return { ok: false, error: '请先创建项目空间' };
    const requestedSpaceId = String((data && data.spaceId) || '');
    const spaceId = spaces.some((s) => s.id === requestedSpaceId) ? requestedSpaceId : spaces[0].id;
    const now = Date.now();
    const note = { id: uid('note'), spaceId, title: '', content: '', createdAt: now, updatedAt: now };
    store.set('notes', [note, ...getNotes(store)]);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, noteId: note.id, ...snapshot(store) };
  });

  ipcMain.handle('note:save', (e, data) => {
    const d = data || {};
    const notes = getNotes(store);
    const index = notes.findIndex((note) => note && note.id === d.id);
    if (index < 0) return { ok: false, error: '记事本不存在' };
    const title = String(d.title || '').trim();
    const content = String(d.content || '');
    if (title.length > NOTE_TITLE_MAX) return { ok: false, error: `标题不能超过 ${NOTE_TITLE_MAX} 个字符` };
    if (content.length > NOTE_CONTENT_MAX) return { ok: false, error: '记事本正文不能超过 100000 个字符' };
    notes[index] = { ...notes[index], title, content, updatedAt: Date.now() };
    store.set('notes', notes);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('note:delete', (e, id) => {
    const idStr = String(id || '');
    const notes = getNotes(store);
    if (!notes.some((note) => note && note.id === idStr)) return { ok: false, error: '记事本不存在' };
    store.set('notes', notes.filter((note) => !note || note.id !== idStr));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // ---------- P3-M5~M6：任务与关联定点提醒 ----------
  ipcMain.handle('task:save', (e, data) => {
    const d = data || {};
    const tasks = getTasks(store);
    const index = d.id ? tasks.findIndex((task) => task && task.id === d.id) : -1;
    if (d.id && index < 0) return { ok: false, error: '任务不存在' };
    const existing = index >= 0 ? tasks[index] : null;
    const normalized = normalizeTask(d, existing);
    if (normalized.error) return { ok: false, error: normalized.error };
    const now = Date.now();
    let savedTask;
    if (existing) {
      savedTask = { ...existing, ...normalized.value, updatedAt: now };
      tasks[index] = savedTask;
    } else {
      savedTask = {
        id: uid('task'), ...normalized.value, completed: false, reminderId: null,
        createdAt: now, updatedAt: now
      };
      tasks.push(savedTask);
    }
    if (typeof d.reminderEnabled === 'boolean') {
      const reminders = getReminders(store);
      const reminderIndex = savedTask.reminderId
        ? reminders.findIndex((item) => item && item.id === savedTask.reminderId)
        : -1;
      if (d.reminderEnabled) {
        const reminder = {
          id: reminderIndex >= 0 ? reminders[reminderIndex].id : uid('reminder'),
          type: 'absolute', text: savedTask.title,
          date: savedTask.kind === 'range' ? savedTask.startDate : savedTask.date,
          time: savedTask.kind === 'today' && savedTask.time ? savedTask.time : '09:00',
          enabled: reminderIndex >= 0 ? reminders[reminderIndex].enabled !== false : true,
          linkedTaskId: savedTask.id
        };
        if (reminderIndex >= 0) reminders[reminderIndex] = { ...reminders[reminderIndex], ...reminder };
        else reminders.push(reminder);
        savedTask.reminderId = reminder.id;
        tasks[tasks.findIndex((item) => item.id === savedTask.id)] = savedTask;
        store.set('reminders', reminders);
        reminderChanged(reminder.id);
      } else if (savedTask.reminderId) {
        const removedId = savedTask.reminderId;
        savedTask.reminderId = null;
        tasks[tasks.findIndex((item) => item.id === savedTask.id)] = savedTask;
        store.set('reminders', reminders.filter((item) => !item || item.id !== removedId));
        reminderChanged(removedId);
      }
    }
    store.set('tasks', tasks);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('task:toggle-complete', (e, data) => {
    const id = String((data && data.id) || '');
    const tasks = getTasks(store);
    const index = tasks.findIndex((task) => task && task.id === id);
    if (index < 0) return { ok: false, error: '任务不存在' };
    const completed = data && typeof data.completed === 'boolean' ? data.completed : !tasks[index].completed;
    tasks[index] = { ...tasks[index], completed, updatedAt: Date.now() };
    store.set('tasks', tasks);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('task:delete', (e, data) => {
    const idStr = String((data && typeof data === 'object' ? data.id : data) || '');
    const tasks = getTasks(store);
    const task = tasks.find((item) => item && item.id === idStr);
    if (!task) return { ok: false, error: '任务不存在' };
    if (task.reminderId) {
      const strategy = data && typeof data === 'object' ? data.reminderStrategy : '';
      if (!['keep', 'delete'].includes(strategy)) return { ok: false, error: '请选择保留或一并删除关联提醒' };
      const reminders = getReminders(store);
      if (strategy === 'delete') store.set('reminders', reminders.filter((item) => !item || item.id !== task.reminderId));
      else store.set('reminders', reminders.map((item) => item && item.id === task.reminderId ? { ...item, linkedTaskId: null } : item));
      reminderChanged(task.reminderId);
    }
    store.set('tasks', tasks.filter((task) => !task || task.id !== idStr));
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  // ---------- P3-M6：工作台提醒管理 ----------
  ipcMain.handle('workspace-reminder:save', (e, data) => {
    const d = data || {};
    const reminders = getReminders(store);
    const index = d.id ? reminders.findIndex((item) => item && item.id === d.id) : -1;
    if (d.id && index < 0) return { ok: false, error: '提醒不存在' };
    const existingReminder = index >= 0 ? reminders[index] : null;
    const normalizedReminder = normalizeReminder(d, existingReminder);
    if (normalizedReminder.error) return { ok: false, error: normalizedReminder.error };
    const reminder = existingReminder
      ? { ...existingReminder, ...normalizedReminder.value }
      : { id: uid('reminder'), ...normalizedReminder.value };
    if (index >= 0) reminders[index] = reminder;
    else reminders.push(reminder);
    store.set('reminders', reminders);
    reminderChanged(reminder.id);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('workspace-reminder:toggle', (e, data) => {
    const id = String((data && data.id) || '');
    const reminders = getReminders(store);
    const index = reminders.findIndex((item) => item && item.id === id);
    if (index < 0) return { ok: false, error: '提醒不存在' };
    reminders[index] = { ...reminders[index], enabled: data && typeof data.enabled === 'boolean' ? data.enabled : !reminders[index].enabled };
    store.set('reminders', reminders);
    reminderChanged(id);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });

  ipcMain.handle('workspace-reminder:delete', (e, id) => {
    const idStr = String(id || '');
    const reminders = getReminders(store);
    const reminder = reminders.find((item) => item && item.id === idStr);
    if (!reminder) return { ok: false, error: '提醒不存在' };
    store.set('reminders', reminders.filter((item) => !item || item.id !== idStr));
    if (reminder.linkedTaskId) {
      store.set('tasks', getTasks(store).map((task) => task && task.id === reminder.linkedTaskId ? { ...task, reminderId: null, updatedAt: Date.now() } : task));
    }
    reminderChanged(idStr);
    broadcast(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, ...snapshot(store) };
  });
}

module.exports = { init };
