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
  // 大模型会话（v2.3：主进程 chat.js 流式后端）
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  chatAbort: () => ipcRenderer.send('chat:abort'),
  chatSetConfig: (cfg) => ipcRenderer.invoke('chat:set-config', cfg),
  chatClearHistory: () => ipcRenderer.invoke('chat:clear-history'),
  // 窗口控制
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:set-ignore-mouse', ignore),
  // 拖动信号（不传坐标：定位坐标由主进程 screen.getCursorScreenPoint 统一计算，
  // 规避渲染层 screenX/Y 在混合 DPI 多屏下的失真）
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragTo: () => ipcRenderer.send('window:drag-to'),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  // 配置中心独立窗口：双击宠物时主进程创建居中设置窗口（宠物窗口不动）/关闭它
  setConfigOpen: (open) => ipcRenderer.send('window:set-config-open', open),
  // 工作台独立窗口（P3-M1）：右键桌宠打开/聚焦；窗口控制与页面路由
  openWorkspace: () => ipcRenderer.send('workspace:open'),
  workspaceGetInit: () => ipcRenderer.invoke('workspace:get-init'),
  workspaceSetPage: (page) => ipcRenderer.send('workspace:set-page', page),
  workspaceWinControl: (action) => ipcRenderer.send('workspace:win-control', action),
  // 主进程 → 渲染层：工作台最大化状态同步（切换「最大化/还原」按钮图形）
  onWorkspaceWinState: (cb) => ipcRenderer.on('workspace:win-state', (e, d) => cb(d)),
  // 项目空间与统一内容模型（P3-M2）：工作台提示词管理页数据与 CRUD；
  // 变更响应统一为 { ok, spaces, entries, defaultSpaceId } 或 { ok: false, error }
  workspaceGetData: () => ipcRenderer.invoke('workspace:get-data'),
  spaceCreate: (name) => ipcRenderer.invoke('space:create', { name }),
  spaceRename: (id, name) => ipcRenderer.invoke('space:rename', { id, name }),
  spaceMove: (id, direction) => ipcRenderer.invoke('space:move', { id, direction }),
  spaceDelete: (id, strategy) => ipcRenderer.invoke('space:delete', { id, strategy }),
  entrySave: (entry) => ipcRenderer.invoke('entry:save', entry),
  entryDelete: (id) => ipcRenderer.invoke('entry:delete', id),
  entryCopyCover: (coverId) => ipcRenderer.invoke('entry:copy-cover', coverId),
  // P3-M4 记事本：零配置创建、自动保存、删除
  noteCreate: (spaceId) => ipcRenderer.invoke('note:create', { spaceId }),
  noteSave: (note) => ipcRenderer.invoke('note:save', note),
  noteDelete: (id) => ipcRenderer.invoke('note:delete', id),
  // 置顶开关（v2.4：配置中心「始终置顶」勾选，关闭时降级普通窗口并停止保活）
  setAlwaysOnTop: (v) => ipcRenderer.invoke('window:set-always-on-top', v),
  // 系统能力
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  quit: () => ipcRenderer.send('app:quit'),
  // 主进程 → 渲染层：提醒触发
  onReminder: (cb) => ipcRenderer.on('reminder:trigger', (e, data) => cb(data)),
  // 主进程 → 渲染层：数据变更（配置窗口改动后同步宠物窗口）
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
  // 主进程 → 渲染层：大模型流式增量 / 完成 / 出错
  onChatChunk: (cb) => ipcRenderer.on('chat:chunk', (e, d) => cb(d)),
  onChatDone: (cb) => ipcRenderer.on('chat:done', () => cb()),
  onChatError: (cb) => ipcRenderer.on('chat:error', (e, d) => cb(d))
});
