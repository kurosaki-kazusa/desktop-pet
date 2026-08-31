// 工作台窗口回归：连续重开不缩小、跨屏恢复按窗口所在屏、字体缩放生效。
'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const Module = require('module');

class MemoryStore {
  constructor(data) { this.data = JSON.parse(JSON.stringify(data)); }
  get(path) { return String(path).split('.').reduce((v, key) => (v == null ? undefined : v[key]), this.data); }
  set(path, value) {
    const keys = String(path).split('.');
    let target = this.data;
    keys.slice(0, -1).forEach((key) => { if (!target[key]) target[key] = {}; target = target[key]; });
    target[keys[keys.length - 1]] = JSON.parse(JSON.stringify(value));
  }
}

const handlers = new Map();
const instances = [];

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.zoomFactor = 1; }
  send() {}
  setZoomFactor(value) { this.zoomFactor = value; }
}

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.maximized = false;
    instances.push(this);
  }
  isDestroyed() { return this.destroyed; }
  isMaximized() { return this.maximized; }
  maximize() { this.maximized = true; }
  unmaximize() { this.maximized = false; }
  setAlwaysOnTop() {}
  moveTop() {}
  show() {}
  focus() {}
  loadFile() {
    this.webContents.emit('did-finish-load');
    this.emit('ready-to-show');
  }
  // 若生产代码再次依赖 DPI 不稳定的读回值，测试立即失败。
  getNormalBounds() { throw new Error('不得读取 getNormalBounds'); }
  close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
}
FakeWindow.fromWebContents = () => null;

const fakeElectron = {
  BrowserWindow: FakeWindow,
  ipcMain: {
    on: (name, fn) => handlers.set(name, fn),
    handle: (name, fn) => handlers.set(name, fn)
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 2300, y: 300 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 1920, y: 0, width: 1280, height: 720 } }),
    getAllDisplays: () => [
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { workArea: { x: 1920, y: 0, width: 1280, height: 720 } }
    ]
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};
const workspaceWindow = require('../main/workspace-window');
Module._load = originalLoad;

const store = new MemoryStore({
  settings: {
    alwaysOnTop: true,
    workspaceWindow: {
      sizeVersion: 3,
      bounds: { x: 100, y: 50, width: 1440, height: 900 },
      maximized: false,
      lastPage: 'prompts'
    }
  }
});

for (let i = 0; i < 3; i += 1) {
  workspaceWindow.open(store);
  const current = instances[instances.length - 1];
  assert.deepStrictEqual(
    { x: current.options.x, y: current.options.y, width: current.options.width, height: current.options.height },
    { x: 100, y: 50, width: 1440, height: 900 },
    `第 ${i + 1} 次打开尺寸不得缩小`
  );
  assert.equal(current.webContents.zoomFactor, 1, '不得用页面缩放换取字体大小，否则 CSS 视口会缩水');
  assert.equal(current.options.minWidth, 1440);
  assert.equal(current.options.minHeight, 900);
  current.close();
}

assert.deepStrictEqual(store.get('settings.workspaceWindow.bounds'), { x: 100, y: 50, width: 1440, height: 900 });

workspaceWindow.open(store);
let current = instances[instances.length - 1];
current.emit('will-resize', {}, { x: 120, y: 70, width: 1500, height: 920 });
current.close();
workspaceWindow.open(store);
current = instances[instances.length - 1];
assert.deepStrictEqual(
  { x: current.options.x, y: current.options.y, width: current.options.width, height: current.options.height },
  { x: 120, y: 70, width: 1500, height: 920 },
  '用户主动缩放后的逻辑尺寸应被记住'
);
current.close();

store.set('settings.workspaceWindow', {
  ...store.get('settings.workspaceWindow'),
  sizeVersion: 3,
  bounds: { x: -5000, y: -3000, width: 1600, height: 1000 }
});
workspaceWindow.open(store);
current = instances[instances.length - 1];
assert.deepStrictEqual(
  { x: current.options.x, y: current.options.y, width: current.options.width, height: current.options.height },
  { x: 1920, y: 0, width: 1440, height: 900 },
  '保存的显示器断开后应回到鼠标所在屏，且小屏不得压缩 1440×900 视口'
);
current.close();

workspaceWindow.open(store);
current = instances[instances.length - 1];
current.emit('will-resize', {}, { x: 1920, y: 0, width: 800, height: 533 });
current.close();
assert.deepStrictEqual(
  store.get('settings.workspaceWindow.bounds'),
  { x: 1920, y: 0, width: 1440, height: 900 },
  '系统异常给出 800×533 时，持久化账本必须钳制为 1440×900'
);

console.log('  ✓ 连续重开 3 次尺寸稳定，不读取 DPI 不可靠的 getNormalBounds');
console.log('  ✓ 跨屏恢复按窗口所在显示器，不受鼠标所在小屏影响');
console.log('  ✓ 用户主动缩放可持久化，页面保持 100% 缩放与 1440×900 最小视口');
console.log('  ✓ 显示器断开与系统异常小尺寸均回退为 1440×900');
console.log('\n全部通过：4 项');
