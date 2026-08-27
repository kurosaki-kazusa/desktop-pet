// main/workspace-window.js · P3-M1：正式工作台独立窗口
// 职责：窗口创建/聚焦（单例）、自定义标题栏窗口控制、位置尺寸持久化（settings.workspaceWindow）、
// 多屏边界修正、lastPage 页面记忆。关闭工作台不退出桌宠（宠物窗口是主生命周期，见 main.js）。

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const WS_W = 1180;
const WS_H = 760;
const WS_MIN_W = 960;
const WS_MIN_H = 640;
// 四项顶部导航页（与 workspace.html 的 data-page / #page-* 对应）
const PAGES = ['notes', 'prompts', 'schedule', 'settings'];

let win = null;
let saveTimer = null;

function getWsSettings(store) {
  const s = store.get('settings.workspaceWindow');
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
}

// 多屏边界修正：保存的窗口中心点不在任何屏幕工作区内（拔掉显示器/改分辨率）时，
// 回到鼠标所在屏幕居中；恢复尺寸夹在 [最小尺寸, 工作区] 区间内，不超出屏幕
function resolveBounds(saved) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = Math.min(WS_W, area.width);
  const h = Math.min(WS_H, area.height);
  if (
    saved
    && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && Number.isFinite(saved.width) && Number.isFinite(saved.height)
  ) {
    const cx = saved.x + saved.width / 2;
    const cy = saved.y + saved.height / 2;
    const visible = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height;
    });
    if (visible) {
      return {
        width: Math.min(Math.max(Math.round(saved.width), WS_MIN_W), area.width),
        height: Math.min(Math.max(Math.round(saved.height), WS_MIN_H), area.height),
        x: Math.round(saved.x),
        y: Math.round(saved.y)
      };
    }
  }
  return {
    width: w,
    height: h,
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2)
  };
}

// 最大化状态同步给渲染层（切换标题栏「最大化/还原」按钮图形）
function sendWinState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('workspace:win-state', { maximized: win.isMaximized() });
  }
}

function persistNow(store) {
  if (!win || win.isDestroyed()) return;
  const cur = getWsSettings(store);
  // 最大化时 getNormalBounds() 返回还原态尺寸——保证「最大化后关闭再打开」不丢用户调整的大小；
  // 尺寸向下钳到最小值：Win11 贴靠布局/拖动还原等路径可能绕过 minWidth/minHeight 约束
  // 产生低于 960×640 的过渡态 bounds，防抖若恰好捕获会持久化非法尺寸，此处兜底归正
  const b = win.getNormalBounds();
  store.set('settings.workspaceWindow', {
    ...cur,
    bounds: {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(WS_MIN_W, Math.round(b.width)),
      height: Math.max(WS_MIN_H, Math.round(b.height))
    },
    maximized: win.isMaximized()
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
  const bounds = resolveBounds(saved.bounds);
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
  if (saved.maximized) win.maximize(); // 显示前恢复最大化，避免先弹正常尺寸再闪变
  win.once('ready-to-show', () => {
    win.show();
    sendWinState();
  });
  win.loadFile('workspace.html');
  win.on('resize', () => persistSoon(store));
  win.on('move', () => persistSoon(store));
  win.on('maximize', sendWinState);
  win.on('unmaximize', sendWinState);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistNow(store); // 关闭前兜底落盘（防抖中的最后一次变动不丢失）
  });
  win.on('closed', () => { win = null; });
}

// IPC 登记（main.js registerIpc 内调用一次）
function init(store) {
  // 宠物窗口右键 → 打开/聚焦工作台
  ipcMain.on('workspace:open', () => open(store));
  // 工作台初始页面：恢复上次停留页面（首次默认提示词管理工具；
  // P3-M7 接入「默认打开界面」设置后按设置优先）
  ipcMain.handle('workspace:get-init', () => {
    const last = getWsSettings(store).lastPage;
    return { page: PAGES.includes(last) ? last : 'prompts' };
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

module.exports = { init, open };
