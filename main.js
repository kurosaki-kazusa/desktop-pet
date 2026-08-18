// main.js · Electron 主进程：窗口 / IPC / 数据 / 提醒调度器
const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

// 统一缩放因子为 1：彻底消除 Windows 混合 DPI 下 setPosition 的隐形尺寸漂移
// （主屏修复后副屏仍漂移的根因——缩放不同的显示器走不同的 DIP 换算路径）。
// 必须在窗口创建前设置。代价：缩放≠100% 的屏幕上宠物物理尺寸变小，
// 如需补偿可调大 index.html 中 #pet 的 emoji 字号
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ---------- 数据层（electron-store） ----------
const store = new Store({
  defaults: {
    reminders: [],
    commands: [],
    settings: { windowPos: null, volume: 0.8 },
    seeded: false
  }
});

// 缩放因子统一后位置坐标含义从 DIP 变为物理像素，旧值作废，一次性清空
if (!store.get('posSchemaV2')) {
  store.set('settings.windowPos', null);
  store.set('posSchemaV2', true);
}

// 首次启动预置：护眼提醒 + 使用时长提醒（用户可修改间隔）
function seedPresets() {
  if (store.get('seeded')) return;
  store.set('reminders', [
    { id: 'preset-eye', type: 'interval', intervalMin: 45, text: '该休息眼睛啦，看看远处 20 秒', enabled: true, preset: 'eye' },
    { id: 'preset-usage', type: 'interval', intervalMin: 60, text: '已使用电脑 1 小时，起来活动一下、喝口水', enabled: true, preset: 'usage' }
  ]);
  store.set('seeded', true);
}

// ---------- 窗口 ----------
let win = null;
const WIN_W = 560; // 宠物窗口尺寸（与 styles.css 的弹窗/字号配套）
const WIN_H = 560;
const CFG_W = 700; // 配置中心独立窗口尺寸（居中，类似应用设置窗口）
const CFG_H = 680;
let lastLogicalPos = null; // 主进程自维护的窗口位置（拖动期间唯一位置来源，不读 getPosition）

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
    win.webContents.send('reminder:trigger', { text: r.text });
  }
}

function tick() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const today = now.toDateString();
  let reminders = [];
  try {
    reminders = store.get('reminders') || [];
  } catch (e) {
    reminders = []; // 数据损坏兜底，不崩溃
  }
  for (const r of reminders) {
    if (!r.enabled) continue;
    if (r.type === 'absolute') {
      if (r.time === hhmm && firedAbsolute.get(r.id) !== today) {
        firedAbsolute.set(r.id, today);
        triggerReminder(r);
      }
    } else if (r.type === 'interval') {
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
    // v2.0 数据迁移：原“显示在右键复制看板”（quick）字段改为“置顶”（pinned）——
    // 旧数据 quick=true 迁移为 pinned=true（保持用户已勾选状态），quick 字段移除；
    // 置顶无数量上限（原复制看板最多 5 条的限制随看板功能一起下线）
    const raw = store.get('commands') || [];
    const commands = raw.map((c) => {
      const { quick, ...rest } = c;
      return { ...rest, pinned: quick === true || c.pinned === true };
    });
    if (commands.some((c, i) => c.pinned !== raw[i].pinned || raw[i].quick !== undefined)) {
      store.set('commands', commands);
    }
    return {
      reminders: store.get('reminders'),
      commands,
      settings: store.get('settings')
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
    const list = store.get('reminders').map(x => (x.id === r.id ? r : x));
    store.set('reminders', list);
    nextFireAt.delete(r.id); // 间隔变更后重新计时
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });
  ipcMain.handle('reminder:remove', (e, id) => {
    const list = store.get('reminders').filter(x => x.id !== id);
    store.set('reminders', list);
    nextFireAt.delete(id);
    firedAbsolute.delete(id);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });

  // 命令 CRUD
  ipcMain.handle('command:add', (e, c) => {
    const list = store.get('commands');
    list.push(c);
    store.set('commands', list);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });
  ipcMain.handle('command:update', (e, c) => {
    const list = store.get('commands').map(x => (x.id === c.id ? c : x));
    store.set('commands', list);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
  });
  ipcMain.handle('command:remove', (e, id) => {
    const list = store.get('commands').filter(x => x.id !== id);
    store.set('commands', list);
    broadcastDataChanged(BrowserWindow.fromWebContents(e.sender));
    return list;
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
  let cfgWin = null;
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
    cfgWin.loadFile('index.html', { query: { mode: 'config' } });
    cfgWin.on('closed', () => { cfgWin = null; cfgPos = null; });
  }
  ipcMain.on('window:set-config-open', (e, open) => {
    if (open) {
      openConfigWin();
    } else if (cfgWin && !cfgWin.isDestroyed()) {
      cfgWin.close();
    }
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
  seedPresets();
  registerIpc();
  createWindow();
  setInterval(tick, 10000);
});

app.on('before-quit', savePos);
app.on('window-all-closed', () => app.quit());
