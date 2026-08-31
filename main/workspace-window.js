// main/workspace-window.js · P3-M1：正式工作台独立窗口
// 职责：窗口创建/聚焦（单例）、自定义标题栏窗口控制、位置尺寸持久化（settings.workspaceWindow）、
// 多屏边界修正、lastPage 页面记忆。关闭工作台不退出桌宠（宠物窗口是主生命周期，见 main.js）。

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// 2026-08-28：工作台窗口与 CSS 内容视口最低保持 1440×900；小屏不再自动压缩。
const WS_W = 1440;
const WS_H = 900;
const WS_MIN_W = 1440;
const WS_MIN_H = 900;
const WS_SIZE_VERSION = 3;
// 四项顶部导航页（与 workspace.html 的 data-page / #page-* 对应）
const PAGES = ['notes', 'prompts', 'schedule', 'settings'];

let win = null;
let saveTimer = null;
let logicalBounds = null;

function setAlwaysOnTop(enabled) {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled !== false, enabled !== false ? 'screen-saver' : 'normal');
}

function moveTop() {
  if (win && !win.isDestroyed()) win.moveTop();
}

function getWsSettings(store) {
  const s = store.get('settings.workspaceWindow');
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
}

// 多屏边界修正：保存的窗口中心点不在任何屏幕工作区内（拔掉显示器/改分辨率）时，
// 回到鼠标所在屏幕；尺寸始终不低于 1440×900。小屏只修正左上角，不压缩内容视口。
function resolveBounds(saved) {
  const displays = screen.getAllDisplays();
  const fallbackArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (
    saved
    && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && Number.isFinite(saved.width) && Number.isFinite(saved.height)
  ) {
    const cx = saved.x + saved.width / 2;
    const cy = saved.y + saved.height / 2;
    const display = displays.find((d) => {
      const wa = d.workArea;
      return cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height;
    });
    if (display) {
      const area = display.workArea;
      const width = Math.max(Math.round(saved.width), WS_MIN_W);
      const height = Math.max(Math.round(saved.height), WS_MIN_H);
      return {
        width,
        height,
        x: width <= area.width ? Math.min(Math.max(Math.round(saved.x), area.x), area.x + area.width - width) : area.x,
        y: height <= area.height ? Math.min(Math.max(Math.round(saved.y), area.y), area.y + area.height - height) : area.y
      };
    }
  }
  const area = fallbackArea;
  const w = WS_W;
  const h = WS_H;
  return {
    width: w,
    height: h,
    x: area.width >= w ? Math.round(area.x + (area.width - w) / 2) : area.x,
    y: area.height >= h ? Math.round(area.y + (area.height - h) / 2) : area.y
  };
}

// 最大化状态同步给渲染层（切换标题栏「最大化/还原」按钮图形）
function sendWinState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('workspace:win-state', { maximized: win.isMaximized() });
  }
}

function persistNow(store) {
  if (!win || win.isDestroyed() || !logicalBounds) return;
  const cur = getWsSettings(store);
  // 不读取 getNormalBounds：Windows 混合 DPI/系统自动归正可能让读回值逐次缩小。
  // 只保存 will-move / will-resize 给出的用户逻辑尺寸账本。
  store.set('settings.workspaceWindow', {
    ...cur,
    bounds: { ...logicalBounds },
    maximized: win.isMaximized(),
    sizeVersion: WS_SIZE_VERSION
  });
}

// 拖动/缩放期间高频触发，防抖后再落盘
function persistSoon(store) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow(store);
  }, 400);
}

// 打开工作台：已打开时只恢复聚焦不重复创建；宠物窗口原位不动
function open(store) {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  const saved = getWsSettings(store);
  // 尺寸版本升级时忽略旧的小窗口缓存一次；之后继续尊重用户手动放大的尺寸。
  const bounds = resolveBounds(saved.sizeVersion === WS_SIZE_VERSION ? saved.bounds : null);
  logicalBounds = { ...bounds };
  // 尺寸版本升级直接保存“准备创建”的逻辑尺寸，避免关闭时读取 OS/DPI 调整值形成缩小循环。
  if (saved.sizeVersion !== WS_SIZE_VERSION) {
    store.set('settings.workspaceWindow', { ...saved, bounds: { ...bounds }, sizeVersion: WS_SIZE_VERSION });
  }
  win = new BrowserWindow({
    ...bounds,
    minWidth: WS_MIN_W,
    minHeight: WS_MIN_H,
    show: false, // 待首次渲染完成再显示（ready-to-show），避免加载期间闪现
    frame: false, // 自定义深色钢蓝标题栏（设计规范 §8.1）
    backgroundColor: '#fbfaf7',
    title: '流萤工作台',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  setAlwaysOnTop((store.get('settings') || {}).alwaysOnTop !== false);
  if (saved.maximized) win.maximize(); // 显示前恢复最大化，避免先弹正常尺寸再闪变
  win.once('ready-to-show', () => {
    win.show();
    sendWinState();
  });
  win.loadFile('workspace.html');
  // 只跟踪用户真实移动/缩放事件，程序启动与 DPI 自动调整不会污染持久化尺寸。
  win.on('will-resize', (e, next) => {
    if (win.isMaximized()) return;
    logicalBounds = {
      x: Math.round(next.x), y: Math.round(next.y),
      width: Math.max(WS_MIN_W, Math.round(next.width)),
      height: Math.max(WS_MIN_H, Math.round(next.height))
    };
    persistSoon(store);
  });
  win.on('will-move', (e, next) => {
    if (win.isMaximized()) return;
    logicalBounds = {
      x: Math.round(next.x), y: Math.round(next.y),
      width: Math.max(WS_MIN_W, Math.round(next.width || logicalBounds.width)),
      height: Math.max(WS_MIN_H, Math.round(next.height || logicalBounds.height))
    };
    persistSoon(store);
  });
  win.on('maximize', sendWinState);
  win.on('unmaximize', sendWinState);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistNow(store); // 关闭前兜底落盘（防抖中的最后一次变动不丢失）
  });
  win.on('closed', () => { win = null; logicalBounds = null; });
}

// IPC 登记（main.js registerIpc 内调用一次）
function init(store) {
  // 宠物窗口右键 → 打开/聚焦工作台
  ipcMain.on('workspace:open', () => open(store));
  // P3-M7：默认打开界面优先；损坏/缺失时回退上次停留页，再回退提示词页。
  ipcMain.handle('workspace:get-init', () => {
    const preferred = (store.get('settings') || {}).defaultPage;
    const last = getWsSettings(store).lastPage;
    return { page: ['notes', 'prompts'].includes(preferred) ? preferred : (PAGES.includes(last) ? last : 'prompts') };
  });
  // 页面切换持久化（lastPage）
  ipcMain.on('workspace:set-page', (e, page) => {
    if (!PAGES.includes(page)) return;
    const cur = getWsSettings(store);
    store.set('settings.workspaceWindow', { ...cur, lastPage: page });
  });
  // 自定义标题栏窗口控制（作用于发送方窗口，不与其他窗口混淆）
  ipcMain.on('workspace:win-control', (e, action) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed()) return;
    if (action === 'minimize') w.minimize();
    else if (action === 'maximize') {
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
    } else if (action === 'close') w.close();
  });
}

module.exports = { init, open, setAlwaysOnTop, moveTop };
