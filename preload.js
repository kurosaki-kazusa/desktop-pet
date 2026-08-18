// preload.js · IPC 桥接：渲染层只暴露白名单接口（contextIsolation 安全边界）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // 数据
  getAll: () => ipcRenderer.invoke('data:get-all'),
  // 提醒管理
  addReminder: (r) => ipcRenderer.invoke('reminder:add', r),
  updateReminder: (r) => ipcRenderer.invoke('reminder:update', r),
  removeReminder: (id) => ipcRenderer.invoke('reminder:remove', id),
  // 命令管理
  addCommand: (c) => ipcRenderer.invoke('command:add', c),
  updateCommand: (c) => ipcRenderer.invoke('command:update', c),
  removeCommand: (id) => ipcRenderer.invoke('command:remove', id),
  // 窗口控制
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:set-ignore-mouse', ignore),
  // 拖动信号（不传坐标：定位坐标由主进程 screen.getCursorScreenPoint 统一计算，
  // 规避渲染层 screenX/Y 在混合 DPI 多屏下的失真）
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragTo: () => ipcRenderer.send('window:drag-to'),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  // 配置中心独立窗口：双击宠物时主进程创建居中设置窗口（宠物窗口不动）/关闭它
  setConfigOpen: (open) => ipcRenderer.send('window:set-config-open', open),
  // 系统能力
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  quit: () => ipcRenderer.send('app:quit'),
  // 主进程 → 渲染层：提醒触发
  onReminder: (cb) => ipcRenderer.on('reminder:trigger', (e, data) => cb(data)),
  // 主进程 → 渲染层：数据变更（配置窗口改动后同步宠物窗口）
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb())
});
