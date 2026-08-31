// main.js · Electron 主进程：窗口 / IPC / 数据 / 提醒调度器
const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { ChatEngine, loadEnvFrom } = require('./chat'); // v2.3 大模型会话后端（复刻 deepseek-harness 会话设计）
const storage = require('./main/storage'); // P3-M0：schema v3 数据底座（迁移/默认值/旧命令映射）
const { isAbsoluteReminderDue } = require('./task-rules');
const workspaceWindow = require('./main/workspace-window'); // P3-M1：正式工作台独立窗口
const content = require('./main/content'); // P3-M2：项目空间与统一内容模型（space:*/entry:*）

// 统一缩放因子为 1：彻底消除 Windows 混合 DPI 下 setPosition 的隐形尺寸漂移
// （主屏修复后副屏仍漂移的根因——缩放不同的显示器走不同的 DIP 换算路径）。
// 必须在窗口创建前设置。代价：缩放≠100% 的屏幕上宠物物理尺寸变小，
// 如需补偿可调大 index.html 中 #pet 的 emoji 字号
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ---------- 数据层（electron-store） ----------
// 大模型会话配置默认值（v2.3）：配置中心「大模型」页签填写；留空则读 .env
const CHAT_DEFAULTS = { apiKey: '', baseUrl: '', model: '', systemPrompt: '' };

const store = new Store({
  defaults: {
    reminders: [],
    commands: [],
    settings: { windowPos: null, volume: 0.8, chat: CHAT_DEFAULTS, alwaysOnTop: true },
    seeded: false
  }
});

// 缩放因子统一后位置坐标含义从 DIP 变为物理像素，旧值作废，一次性清空
if (!store.get('posSchemaV2')) {
  store.set('settings.windowPos', null);
  store.set('posSchemaV2', true);
}

// ---------- 数据迁移：旧 commands → entries；v4 拆分提示词/记事本空间 ----------
// 备份 → 转换 → 校验 → 落盘 → 写 schemaVersion；失败回滚（不写版本号、不删旧字段），
// 备份键 backupSchemaV2 保留供人工恢复。每次启动幂等执行（当前版本只补默认字段）。
const migrationResult = storage.migrate(store);
if (!migrationResult.ok) {
  console.error('[storage] 数据迁移失败（旧数据已保留，可从 backupSchemaV2 恢复）：', migrationResult.error);
}

// ---------- 大模型会话引擎（v2.3：chat.js 流式后端，.env 填 DEEPSEEK_API_KEY 即用） ----------
function getChatSettings() {
  const s = store.get('settings') || {};
  return { ...CHAT_DEFAULTS, ...(s.chat || {}) };
}

function publicChatSettings() {
  return storage.toPublicChatSettings(getChatSettings(), Boolean(chatEnv.DEEPSEEK_API_KEY));
}

// .env 读取目录（后读覆盖先读）：项目根（开发）→ 安装目录（打包后 exe 旁）→ userData（%APPDATA%）
// 真实环境变量（process.env）优先级最高；配置中心页签保存的值优先级又高于 .env（见 chat.js resolveConfig）
function loadChatEnv() {
  let env = {};
  for (const dir of [app.getAppPath(), path.dirname(process.execPath), app.getPath('userData')]) {
    Object.assign(env, loadEnvFrom(dir));
  }
  Object.assign(env, process.env);
  return env;
}
const chatEnv = loadChatEnv();

// ---------- v2.5：打包版 .env 配置文件模板 ----------
// 打包版不含 .env（files 白名单排除），首次启动在安装目录（exe 旁）生成带注释的
// .env 模板供用户直接编辑（Key/地址/模型/人设），loadChatEnv 已把 exe 旁目录纳入读取范围。
// 安装目录不可写（如默认 Program Files）时回落到 userData（同样会被 loadChatEnv 读到）。
// 开发模式（npm start）不生成：项目根已有 .env，避免污染 node_modules\electron 目录。
const ENV_TEMPLATE = [
  '# ============================================================',
  '#  AI 桌宠 · 大模型配置文件（编辑后重启应用生效）',
  '#  配置中心「大模型」页签保存的值优先级高于本文件；',
  '#  如需让本文件生效，请清空配置中心页签中对应的保存值。',
  '# ============================================================',
  '',
  '# API Key（必填，platform.deepseek.com 获取，形如 sk-xxx）',
  'DEEPSEEK_API_KEY=',
  '',
  '# API 地址（留空默认 https://api.deepseek.com，可改中转地址）',
  'DEEPSEEK_BASE_URL=',
  '',
  '# 模型（deepseek-chat 通用对话 / deepseek-reasoner 深度思考）',
  'DEEPSEEK_MODEL=deepseek-chat',
  '',
  '# 角色人设（系统提示词，留空使用内置猫娘人设「咪咪」，支持中文长文本）',
  'DEEPSEEK_SYSTEM_PROMPT=',
  ''
].join('\r\n');

function seedEnvTemplate() {
  if (!app.isPackaged) return; // 开发模式：项目根 .env 已存在，不生成
  for (const dir of [path.dirname(process.execPath), app.getPath('userData')]) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) return;
    try {
      fs.writeFileSync(p, ENV_TEMPLATE, 'utf8');
      return;
    } catch (e) {
      // 目录不可写（如 Program Files）→ 尝试下一处
    }
  }
}

// 找到当前生效的 .env 文件路径（配置中心 UI 展示用，不存在返回空串）
function findEnvFile() {
  for (const dir of [path.dirname(process.execPath), app.getPath('userData'), app.getAppPath()]) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

const chatEngine = new ChatEngine({
  getConfig: () => ({ settings: getChatSettings(), env: chatEnv }),
  // P3-M0：数据源由旧 commands 切换为 entries（旧命令已迁移，标题目录语义不变）
  getCatalog: () => (store.get('entries') || []).map((c) => c.title).filter(Boolean),
  loadHistory: () => store.get('chat.history') || [],
  saveHistory: (h) => store.set('chat.history', h),
  loadSummary: () => store.get('chat.historySummary') || '',
  saveSummary: (s) => store.set('chat.historySummary', s)
});

// 首次启动仅预置使用时长提醒（用户可修改间隔）；护眼提醒由用户按需创建
function seedPresets() {
  const reminders = Array.isArray(store.get('reminders')) ? store.get('reminders') : [];
  const withoutLegacyEyePreset = reminders.filter((r) => !(
    r.id === 'preset-eye'
    && r.preset === 'eye'
    && r.type === 'interval'
    && r.intervalMin === 45
    && r.text === '该休息眼睛啦，看看远处 20 秒'
  ));
  if (withoutLegacyEyePreset.length !== reminders.length) {
    store.set('reminders', withoutLegacyEyePreset);
  }

  if (store.get('seeded')) return;
  store.set('reminders', [
    { id: 'preset-usage', type: 'interval', intervalMin: 60, text: '已使用电脑 1 小时，起来活动一下、喝口水', enabled: true, preset: 'usage' }
  ]);
  store.set('seeded', true);
}

// ---------- 窗口 ----------
let win = null;
let cfgWin = null; // 配置中心独立窗口（v1.4）；顶层声明供置顶保活 keepTop/applyTop 引用
const WIN_W = 560; // 宠物窗口尺寸（与 styles.css 的弹窗/字号配套）
const WIN_H = 560;
const CFG_W = 700; // 配置中心独立窗口尺寸（居中，类似应用设置窗口）
const CFG_H = 680;
let lastLogicalPos = null; // 主进程自维护的窗口位置（拖动期间唯一位置来源，不读 getPosition）

// ---------- 置顶保活（v2.4） ----------
// Windows TOPMOST 无绝对优先级：其他置顶窗口后来激活会盖住桌宠。
// 方案：①创建后提升到 screen-saver 级（高于默认 floating，压过绝大多数置顶窗口）
//      ②每 5 秒 moveTop 保活（只调 Z 序、不抢焦点、无闪烁），被盖住后自动回到最前
//      ③配置中心加「始终置顶」开关（settings.alwaysOnTop），关闭时降级为普通窗口不保活
function isTopEnabled() {
  const s = store.get('settings') || {};
  return s.alwaysOnTop !== false;
}

function keepTop() {
  if (!isTopEnabled()) return;
  if (win && !win.isDestroyed()) win.moveTop();
  if (cfgWin && !cfgWin.isDestroyed()) cfgWin.moveTop();
  workspaceWindow.moveTop();
}

function applyTop(enabled) {
  const level = enabled ? 'screen-saver' : 'normal';
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, level);
  if (cfgWin && !cfgWin.isDestroyed()) cfgWin.setAlwaysOnTop(enabled, level);
  workspaceWindow.setAlwaysOnTop(enabled);
}

function savePos() {
  // 优先用主进程自维护的逻辑位置：Windows 混合 DPI 下 win.getPosition() 可能与
  // setPosition 设定值存在往返误差，读回参与计算会导致每次拖动向下漂移
  const pos = lastLogicalPos || (win && !win.isDestroyed() ? posFromWin() : null);
  if (pos) store.set('settings.windowPos', pos);
}

function posFromWin() {
  const [x, y] = win.getPosition();
  return { x, y };
}

// 多屏校验：保存的位置必须落在某块屏幕可视区域内（宠物主体至少 32px 可见），
// 否则用 getDisplayNearestPoint 就近修正——覆盖拔掉副屏、更换分辨率、缩放变更等场景
function resolveWindowPos() {
  const pos = store.get('settings.windowPos');
  const MARGIN = 32; // 宠物本体位于窗口底部居中，保证这部分可见即可拖回
  const isVisible = (p) => screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      p.x + WIN_W - MARGIN > a.x && p.x + MARGIN < a.x + a.width &&
      p.y + WIN_H - MARGIN > a.y && p.y + MARGIN < a.y + a.height
    );
  });
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && isVisible(pos)) {
    return { x: pos.x, y: pos.y };
  }
  // 无效/越界：就近吸附到最近屏幕的右下角
  const ref = pos && Number.isFinite(pos.x) ? { x: pos.x, y: pos.y } : screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(ref);
  const a = d.workArea;
  return { x: a.x + a.width - WIN_W - 24, y: a.y + a.height - WIN_H - 24 };
}

function createWindow() {
  const pos = resolveWindowPos();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    frame: false,          // 无边框
    transparent: true,     // 真 alpha 透明
    useContentSize: true,  // 位置/尺寸以内容区为准，减少 Windows 非100%缩放下的漂移
    alwaysOnTop: true,     // 置顶
    resizable: false,
    skipTaskbar: true,     // 不占任务栏
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isTopEnabled()) win.setAlwaysOnTop(true, 'screen-saver'); // v2.4：提升置顶层级（floating→screen-saver）
  lastLogicalPos = { x: pos.x, y: pos.y };
  // 默认点击穿透；渲染层鼠标进入可交互区域时通过 IPC 动态恢复交互
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
}

// ---------- 提醒调度器（10 秒轮询） ----------
const firedAbsolute = new Map(); // reminderId -> 已触发的日期字符串（定点提醒每日一次）
const nextFireAt = new Map();    // reminderId -> 下次触发时间戳（周期提醒）

function pad(n) { return String(n).padStart(2, '0'); }

function triggerReminder(r) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('reminder:trigger', { text: r.text, preset: r.preset || '', type: r.type || '' });
  }
}

function tick() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const today = now.toDateString();
  const isoToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let reminders = [];
  try {
    reminders = store.get('reminders') || [];
  } catch (e) {
    reminders = []; // 数据损坏兜底，不崩溃
  }
  for (const r of reminders) {
    if (!r.enabled) continue;
    if (r.type === 'absolute') {
      // P3-M6：新建定点提醒绑定具体日期；旧提醒没有 date 时继续保持“每天”兼容语义。
      if (isAbsoluteReminderDue(r, isoToday, hhmm) && firedAbsolute.get(r.id) !== today) {
        firedAbsolute.set(r.id, today);
        triggerReminder(r);
      }
    } else if (r.type === 'interval' || r.type === 'usage') {
      const minutes = Math.max(1, Number(r.intervalMin) || 1);
      let next = nextFireAt.get(r.id);
      if (!next) {
        nextFireAt.set(r.id, Date.now() + minutes * 60000);
      } else if (Date.now() >= next) {
        nextFireAt.set(r.id, Date.now() + minutes * 60000);
        triggerReminder(r);
      }
    }
  }
}

// ---------- IPC 接口 ----------
function registerIpc() {
  // 数据读取
  ipcMain.handle('data:get-all', () => {
    // P3-M0：数据源由旧 commands 切换为 schema v3 entries，经映射辅助转为命令 UI 形态
    // （渲染层零改动复用；v2.0 的 quick→pinned 迁移已由 storage.migrate 在启动时完成）
    const commands = storage.commandsFromEntries(store.get('entries') || []);
    return {
      reminders: store.get('reminders'),
      commands,
      // P3-M7：渲染层只接收 Key 配置状态，不再回传真实 Key。
      settings: { ...store.get('settings'), chat: publicChatSettings() },
      envFile: findEnvFile() // v2.5：当前 .env 配置文件路径（配置中心展示，找不到为空串）
    };
  });

  // 提醒 CRUD
  ipcMain.handle('reminder:add', (e, r) => {
    const list = store.get('reminders');
    list.push(r);
    store.set('reminders', list);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });
  ipcMain.handle('reminder:update', (e, r) => {
    const list = store.get('reminders').map((x) => {
      if (x.id !== r.id) return x;
      // 旧配置中心仍复用该入口；关联任务提醒不能被旧表单改成周期提醒或丢失日期关联。
      return x.linkedTaskId
        ? { ...x, ...r, type: 'absolute', date: x.date, linkedTaskId: x.linkedTaskId }
        : { ...x, ...r };
    });
    store.set('reminders', list);
    nextFireAt.delete(r.id); // 间隔变更后重新计时
    firedAbsolute.delete(r.id);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });
  ipcMain.handle('reminder:remove', (e, id) => {
    const removed = (store.get('reminders') || []).find((x) => x && x.id === id);
    const list = store.get('reminders').filter(x => x.id !== id);
    store.set('reminders', list);
    if (removed && removed.linkedTaskId) {
      store.set('tasks', (store.get('tasks') || []).map((task) => task && task.id === removed.linkedTaskId
        ? { ...task, reminderId: null, updatedAt: Date.now() }
        : task));
    }
    nextFireAt.delete(id);
    firedAbsolute.delete(id);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });

  // 命令 CRUD（P3-M0：底层存储切换为 entries；对外 IPC 形态不变，渲染层零改动）
  ipcMain.handle('command:add', (e, c) => {
    const entries = store.get('entries') || [];
    entries.push(storage.entryFromCommand(c));
    store.set('entries', entries);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return storage.commandsFromEntries(entries);
  });
  ipcMain.handle('command:update', (e, c) => {
    const entries = (store.get('entries') || []).map((x) => (x.id === c.id ? storage.applyCommandToEntry(x, c) : x));
    store.set('entries', entries);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return storage.commandsFromEntries(entries);
  });
  ipcMain.handle('command:remove', (e, id) => {
    const entries = (store.get('entries') || []).filter(x => x.id !== id);
    store.set('entries', entries);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return storage.commandsFromEntries(entries);
  });

  // 大模型会话（v2.3）：流式对话入口 / 中止 / 配置保存 / 清空历史
  ipcMain.handle('chat:send', (e, text) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed()) return false;
    return chatEngine.send(text, {
      onChunk: (d) => { if (!w.isDestroyed()) w.webContents.send('chat:chunk', d); },
      onDone: () => { if (!w.isDestroyed()) w.webContents.send('chat:done'); },
      onError: (d) => { if (!w.isDestroyed()) w.webContents.send('chat:error', d); }
    });
  });
  ipcMain.on('chat:abort', () => chatEngine.abort());
  ipcMain.handle('chat:set-config', (e, cfg) => {
    const d = cfg || {};
    const apiKey = String(d.apiKey || '').trim();
    const baseUrl = String(d.baseUrl || '').trim();
    const model = String(d.model || '').trim();
    const systemPrompt = String(d.systemPrompt || '').trim();
    if (apiKey.length > 512) return { ok: false, error: 'API Key 长度无效' };
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: '接口地址仅支持 HTTP/HTTPS' };
      } catch { return { ok: false, error: '接口地址格式无效' }; }
    }
    if (!['', 'deepseek-chat', 'deepseek-reasoner'].includes(model)) return { ok: false, error: '模型名称无效' };
    if (systemPrompt.length > 10000) return { ok: false, error: '助手人设不能超过 10000 个字符' };
    const previous = getChatSettings();
    store.set('settings.chat', {
      apiKey: d.clearApiKey === true ? '' : (apiKey || previous.apiKey),
      baseUrl,
      model,
      systemPrompt
    });
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return { ok: true };
  });
  ipcMain.handle('chat:clear-history', () => {
    chatEngine.clearHistory();
    return true;
  });

  // 窗口控制
  ipcMain.on('window:set-ignore-mouse', (e, ignore) => {
    if (!win) return;
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
  // 拖动（绝对锚点方案）：按下时记录窗口原点与鼠标的偏移，拖动中用“当前鼠标 + 偏移”
  // 直接算目标位置——无增量累加，跨屏/混合缩放下不会漂移。
  // 两窗口共用一套机制：宠物窗口（账本 lastLogicalPos，拖完落盘）与配置中心（账本 cfgPos，不落盘）
  let dragAnchor = null;
  let dragWin = null; // 正在拖动的窗口引用
  let cfgPos = null; // 配置中心位置账本（创建时初始化，关闭时清空）

  function posLedgerFor(w) {
    if (w === win) return lastLogicalPos;
    if (w === cfgWin) return cfgPos;
    return null;
  }
  function setLedgerFor(w, x, y) {
    if (w === win) lastLogicalPos = { x, y };
    else if (w === cfgWin) cfgPos = { x, y };
  }

  // 所有显示器的并集包围盒（拖动唯一边界；不按单屏 workArea 限制，
  // 避免跨屏/混合缩放时窗口被“钉”在边界上不跟随鼠标）
  let unionBounds = null;
  function getUnionBounds() {
    if (!unionBounds) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const d of screen.getAllDisplays()) {
        const b = d.bounds;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      unionBounds = { minX, minY, maxX, maxY };
    }
    return unionBounds;
  }
  const invalidateUnion = () => { unionBounds = null; };
  screen.on('display-added', invalidateUnion);
  screen.on('display-removed', invalidateUnion);
  screen.on('display-metrics-changed', invalidateUnion);

  ipcMain.on('window:drag-start', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const pos = w ? posLedgerFor(w) : null;
    if (!w || w.isDestroyed() || !pos) return;
    // 锚点基于自维护位置而非 getPosition：后者在混合 DPI 下与 setPosition 存在
    // 往返误差，读回参与计算会使每次拖动都向下漂移一点（误差闭环累积）
    const p = screen.getCursorScreenPoint();
    dragAnchor = { dx: pos.x - p.x, dy: pos.y - p.y };
    dragWin = w;
  });
  ipcMain.on('window:drag-to', () => {
    if (!dragWin || !dragAnchor) return;
    const p = screen.getCursorScreenPoint();
    // 只限制不拖丢（窗口主体至少保留一部分在全部屏幕并集内），其余完全跟随鼠标
    const isPet = dragWin === win;
    const ww = isPet ? WIN_W : CFG_W;
    const wh = isPet ? WIN_H : CFG_H;
    const keepX = isPet ? 48 : 160; // 宠物至少 48px 可见；配置窗口至少 160px（保留可点击区）
    const keepY = isPet ? 64 : 120;
    const u = getUnionBounds();
    const nx = Math.min(Math.max(Math.round(p.x + dragAnchor.dx), u.minX - ww + keepX), u.maxX - keepX);
    const ny = Math.min(Math.max(Math.round(p.y + dragAnchor.dy), u.minY - wh + keepY), u.maxY - keepY);
    setLedgerFor(dragWin, nx, ny); // 先记账再设位置：后续计算一律以账本为准
    // setBounds 一次调用同时设定位置与尺寸，避开 setPosition 单独调用的
    // 隐形尺寸漂移路径（副屏修复）；配合 force-device-scale-factor=1 双保险
    dragWin.setBounds({ x: nx, y: ny, width: ww, height: wh });
  });
  ipcMain.on('window:drag-end', () => {
    const wasPet = dragWin === win;
    dragAnchor = null;
    dragWin = null;
    if (wasPet) savePos(); // 拖到副屏后退出，下次启动仍能正确恢复到副屏位置（配置窗口不记忆位置）
  });

  // 配置中心独立窗口（v1.4）：双击宠物时创建并居中于鼠标所在屏（类似应用设置窗口），
  // 宠物窗口保持原位不动；配置窗口不置穿透，✕/Esc 关闭
  function openConfigWin() {
    if (cfgWin && !cfgWin.isDestroyed()) {
      cfgWin.focus();
      return;
    }
    const p = screen.getCursorScreenPoint();
    const a = screen.getDisplayNearestPoint(p).workArea;
    const x = Math.max(a.x, Math.round(a.x + (a.width - CFG_W) / 2));
    const y = Math.max(a.y, Math.round(a.y + (a.height - CFG_H) / 2));
    cfgPos = { x, y }; // 位置账本初始化（拖动期间唯一位置来源）
    cfgWin = new BrowserWindow({
      width: CFG_W,
      height: CFG_H,
      x,
      y,
      frame: false,
      transparent: true,
      show: false, // 待首次渲染完成再显示（ready-to-show），避免加载期间内容闪现
      useContentSize: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    cfgWin.once('ready-to-show', () => cfgWin.show()); // 渲染完成后再显示窗口，消除闪现
    cfgWin.loadFile('index.html', { query: { mode: 'config' } });
    if (isTopEnabled()) cfgWin.setAlwaysOnTop(true, 'screen-saver'); // v2.4：与宠物窗口同级保活
    cfgWin.on('closed', () => { cfgWin = null; cfgPos = null; });
  }
  ipcMain.on('window:set-config-open', (e, open) => {
    if (open) {
      openConfigWin();
    } else if (cfgWin && !cfgWin.isDestroyed()) {
      cfgWin.close();
    }
  });

  // 正式工作台独立窗口（P3-M1）：右键桌宠打开/聚焦；关闭工作台不退出桌宠（宠物窗口是主生命周期）。
  // 配置中心窗口代码保留待 P3-M7 设置页接管其能力后下线，右键入口已切换为工作台
  workspaceWindow.init(store);

  // 项目空间与统一内容模型（P3-M2）：工作台提示词管理页数据与 CRUD；
  // 变更会广播 data:changed（宠物窗口 command:* 数据源同为 entries，需同步）
  content.init(store, {
    onReminderChanged: (id) => {
      nextFireAt.delete(id);
      firedAbsolute.delete(id);
    }
  });

  // P3-M7：工作台完整设置页。通用设置统一校验并落盘；真实 API Key 永不返回渲染层。
  ipcMain.handle('workspace-settings:get', () => {
    const settings = storage.mergeSettings(store.get('settings') || {});
    return {
      ok: true,
      settings: { ...settings, chat: publicChatSettings() },
      envFile: findEnvFile(),
      dataPath: app.getPath('userData'),
      version: app.getVersion()
    };
  });

  ipcMain.handle('workspace-settings:save', (e, patch) => {
    const normalized = storage.normalizeSettingsPatch(store.get('settings') || {}, patch);
    if (normalized.error) return { ok: false, error: normalized.error };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin')) {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin === true });
      } catch {
        return { ok: false, error: '无法更新开机启动设置' };
      }
    }
    store.set('settings', normalized.value);
    applyTop(normalized.value.alwaysOnTop);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return { ok: true, settings: { ...normalized.value, chat: publicChatSettings() } };
  });

  // 置顶开关（v2.4）：配置中心「始终置顶」勾选——关闭时降级为普通窗口并停止保活，
  // 把“压过其他置顶窗口”与“让用户主动置顶的应用盖住桌宠”的选择权交给用户
  ipcMain.handle('window:set-always-on-top', (e, v) => {
    const enabled = v !== false;
    store.set('settings.alwaysOnTop', enabled);
    applyTop(enabled);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return enabled;
  });

  // 数据变更广播：配置窗口改动后通知宠物窗口重新拉取（排除发起者自身）
  function broadcastDataChanged(sender) {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (w && !w.isDestroyed() && w !== sender) w.webContents.send('data:changed');
    });
  }

  // 系统能力
  ipcMain.handle('clipboard:write', (e, text) => {
    clipboard.writeText(String(text));
    return true;
  });
  ipcMain.on('app:quit', () => {
    savePos();
    app.quit();
  });
}

// ---------- 应用生命周期 ----------
app.whenReady().then(() => {
  seedEnvTemplate(); // v2.5：打包版首次启动在安装目录生成 .env 配置模板
  seedPresets();
  registerIpc();
  createWindow();
  setInterval(tick, 10000);
  setInterval(keepTop, 5000); // v2.4：置顶保活（每 5 秒重提 Z 序，不抢焦点）
});

app.on('before-quit', savePos);
app.on('window-all-closed', () => app.quit());
