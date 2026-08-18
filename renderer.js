// renderer.js · 渲染层：宠物状态机 / 交互 / 会话气泡 / 配置中心 / 提醒管理 / 提醒表现
// 安全约定：所有用户输入一律 createElement + textContent 渲染，禁止 innerHTML 拼接
// 双模式：宠物窗口（默认）/ 配置中心独立窗口（?mode=config，无宠物交互，面板居中铺开）

const $ = (sel) => document.querySelector(sel);
const api = window.petAPI;

const isConfigWindow = new URLSearchParams(location.search).get('mode') === 'config';
if (isConfigWindow) document.body.classList.add('config-mode');

let state = { reminders: [], commands: [] };

// ---------- 工具 ----------
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1500);
}

// ---------- 宠物状态机（idle / action / remind） ----------
const ACTIONS = ['anim-jump', 'anim-spin', 'anim-wiggle'];
let actionTimer = null;

function setPetState(s) {
  const pet = $('#pet');
  pet.classList.remove('anim-idle', 'anim-remind', ...ACTIONS);
  clearTimeout(actionTimer);
  if (s === 'remind') {
    pet.classList.add('anim-remind');
  } else if (s === 'action') {
    pet.classList.add(ACTIONS[Math.floor(Math.random() * ACTIONS.length)]);
    actionTimer = setTimeout(() => setPetState('idle'), 1200); // 兜底回 idle
  } else {
    pet.classList.add('anim-idle');
  }
}

// ---------- 点击穿透动态切换（仅宠物窗口） ----------
// 拖动中禁止切回穿透：否则 mouseup 会丢失，dragging 状态卡死导致后续定位错乱
// （dragging 声明在下方，监听回调执行时已完成初始化）
if (!isConfigWindow) {
  document.querySelectorAll('.interactive').forEach((node) => {
    node.addEventListener('mouseenter', () => api.setIgnoreMouse(false));
    node.addEventListener('mouseleave', () => { if (!dragging) api.setIgnoreMouse(true); });
  });
}

// ---------- 宠物拖动（绝对坐标方案：主进程按锚点计算目标位置，跨屏不漂移） ----------
const pet = $('#pet');
let dragging = false;
let dragMoved = false;
let anchorX = 0;
let anchorY = 0;

pet.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  dragMoved = false;
  anchorX = e.screenX;
  anchorY = e.screenY;
  api.dragStart(); // 坐标由主进程用 screen.getCursorScreenPoint 采集
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if ((e.buttons & 1) === 0) {
    // 左键已松开但 mouseup 丢失（如在窗口外释放），兜底结束拖动，
    // 防止 dragging 卡死导致后续悬停时窗口被残留拖动状态驱动而漂移
    dragging = false;
    api.dragEnd();
    return;
  }
  if (e.screenX !== anchorX || e.screenY !== anchorY) dragMoved = true;
  if (dragMoved) api.dragTo();
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  api.dragEnd();
});
// 窗口失焦（如 Alt+Tab 切走）时强制结束拖动，避免状态残留
window.addEventListener('blur', () => {
  if (dragging) {
    dragging = false;
    api.dragEnd();
  }
});

// ---------- 左键单击/双击判定（300ms 判定窗口） ----------
let clickTimer = null;

pet.addEventListener('click', (e) => {
  if (dragMoved) return; // 拖动后不触发点击
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    onDoubleClick();
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      onSingleClick();
    }, 300);
  }
});

function onSingleClick() {
  setPetState('action');
}
function onDoubleClick() {
  toggleBubble(); // v2.1：双击打开对话交互面板（与右键配置中心对调，对话是高频主功能）
}

// ---------- 右键打开配置中心（v2.1：与双击对调——右键=设置，符合 Windows 惯例） ----------
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  closeBubble(); // 若对话面板开着先收起
  api.setConfigOpen(true); // 主进程：创建居中配置窗口（宠物窗口原位不动）
});

// 默认问候语：首次打开面板时输出，后续回复持续追加到对话气泡
const CHAT_GREETING = '你好呀，今天过得怎么样？';

function toggleBubble() {
  const bubble = $('#bubble');
  if (bubble.classList.contains('hidden')) {
    bubble.classList.remove('hidden');
    if (!$('#chat-log').hasChildNodes()) addChatMessage(CHAT_GREETING, 'bot');
    $('#chat-input').focus(); // 打开即聚焦输入框，双击后可直接打字
  } else {
    closeBubble();
  }
}
function closeBubble() {
  $('#bubble').classList.add('hidden');
}

// 对话消息追加（who: 'bot' | 'user'，气泡内持续滚动）
function addChatMessage(text, who) {
  const row = el('div', `chat-msg ${who}`);
  if (who === 'bot') row.appendChild(el('span', 'chat-avatar', '🐱'));
  row.appendChild(el('div', 'chat-bubble', text));
  const log = $('#chat-log');
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

// 发送消息：大模型 agent 尚未接入，暂以占位回复代替（接入后替换此处的回复来源即可）
function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  addChatMessage(text, 'user');
  input.value = '';
  addChatMessage('（大模型 agent 接入中…）我先记住你的话啦，等接入后就能真正陪你聊天了！', 'bot');
}
$('#chat-send').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

$('#bubble-close').addEventListener('click', closeBubble);
// 配置中心关闭：独立窗口模式下直接关窗；宠物窗口的面板永远隐藏，此监听不触发
$('#panel-close').addEventListener('click', () => api.setConfigOpen(false));
// 退出宠物（v2.0 移至配置中心底部）
$('#app-quit').addEventListener('click', () => api.quit());

// 点击舞台空白处关闭气泡（穿透区域内的点击无法捕获，此为窗口内兜底）
document.addEventListener('mousedown', (e) => {
  const bubble = $('#bubble');
  if (!bubble.classList.contains('hidden') && !bubble.contains(e.target) && e.target !== pet) {
    closeBubble();
  }
});

// Tab 切换（气泡与配置中心两组各自独立，互不干扰）
function wireTabs(tabsEl, paneMap) {
  tabsEl.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      for (const [key, sel] of Object.entries(paneMap)) {
        $(sel).classList.toggle('hidden', key !== btn.dataset.tab);
      }
      if (btn.dataset.tab === 'reminders') refreshReminders();
    });
  });
}
// 配置中心 Tab 切换（宠物窗口无 Tab，此组仅在配置窗口生效）
wireTabs($('.panel-header .tabs'), { commands: '#ptab-commands', reminders: '#ptab-reminders' });

// ---------- 常用命令组件（仅配置中心：管理全部命令） ----------
// v2.0：原右键“复制看板”已下线，quick 字段改为置顶（pinned）——勾选的条目排在列表最前，无数量上限
const cmdWidgets = [];

function createCommandWidget(container) {
  container.innerHTML = '';

  const list = el('ul', 'list');
  const empty = el('div', 'empty hidden');
  container.append(list, empty);

  // —— 搜索框 + 新增/编辑表单 ——
  let searchInput = null;
  let addBtn = null;
  let form = null;
  let titleInput = null;
  let contentInput = null;
  let pinBox = null;
  let editingId = null;

  function openForm(cmd) {
    editingId = cmd ? cmd.id : null;
    titleInput.value = cmd ? cmd.title : '';
    contentInput.value = cmd ? cmd.content : '';
    pinBox.checked = cmd ? !!cmd.pinned : false; // 新增默认不置顶
    form.classList.remove('hidden');
    addBtn.classList.add('hidden');
  }
  function closeForm() {
    editingId = null;
    form.classList.add('hidden');
    addBtn.classList.remove('hidden');
  }

  searchInput = el('input', 'input search-input');
  searchInput.placeholder = '🔍 按标题关键词搜索命令';
  searchInput.addEventListener('input', () => cmdWidgets.forEach((r) => r()));
  addBtn = el('button', 'btn add', '+ 新增命令');
  form = el('div', 'form hidden');
  titleInput = el('input', 'input');
  titleInput.placeholder = '标题（如：清缓存）';
  titleInput.maxLength = 30;
  contentInput = el('textarea', 'input mono');
  contentInput.placeholder = '命令内容（支持跨行长文本，如多行命令/脚本）';
  contentInput.rows = 4;
  const pinRow = el('label', 'pin-row');
  pinBox = el('input');
  pinBox.type = 'checkbox';
  pinRow.append(pinBox, el('span', '', '置顶显示（排在列表最前面）'));
  const actions = el('div', 'form-actions');
  const saveBtn = el('button', 'btn primary small', '保存');
  const cancelBtn = el('button', 'btn small', '取消');
  actions.append(saveBtn, cancelBtn);
  form.append(titleInput, contentInput, pinRow, actions);
  container.insertBefore(searchInput, list);
  container.insertBefore(addBtn, list);
  container.insertBefore(form, list);

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', closeForm);
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    if (!title || !content) return toast('标题和命令内容都要填写');
    if (content.length > 2000) return toast('命令内容过长（上限 2000 字符）');
    if (editingId) {
      const old = state.commands.find((c) => c.id === editingId);
      state.commands = await api.updateCommand({ ...old, title, content, pinned: pinBox.checked });
    } else {
      state.commands = await api.addCommand({ id: newId('c'), title, content, pinned: pinBox.checked });
    }
    closeForm();
    refreshCommands();
    toast('已保存');
  });

  function render() {
    list.innerHTML = '';
    const kw = searchInput.value.trim().toLowerCase();
    // 置顶条目排在最前（各自保持原有相对顺序），其余跟随
    const base = [...state.commands].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const cmds = kw ? base.filter((c) => c.title.toLowerCase().includes(kw)) : base;

    empty.textContent = state.commands.length === 0
      ? '暂无命令，点上方"+ 新增命令"开始记录'
      : '没有标题匹配该关键词的命令';
    empty.classList.toggle('hidden', cmds.length > 0);

    for (const c of cmds) {
      const li = el('li', 'list-item');
      const main = el('div', 'item-main');
      const titleRow = el('div', 'item-title');
      if (c.pinned) titleRow.appendChild(el('span', 'pin-badge', '📌 '));
      titleRow.appendChild(el('span', '', c.title));
      main.appendChild(titleRow);
      const content = el('div', 'item-sub mono', c.content);
      content.title = '点击复制命令';
      content.addEventListener('click', async () => {
        await api.copyText(c.content);
        toast('已复制到剪贴板');
      });
      main.appendChild(content);
      li.appendChild(main);

      // 右侧小框打勾 = 置顶（排在列表最前面，无数量上限）
      const pinCheck = el('input');
      pinCheck.type = 'checkbox';
      pinCheck.checked = !!c.pinned;
      pinCheck.title = '置顶显示（排在列表最前面）';
      pinCheck.addEventListener('change', async () => {
        state.commands = await api.updateCommand({ ...c, pinned: pinCheck.checked });
        refreshCommands();
      });
      li.appendChild(pinCheck);

      const actionsEl = el('div', 'item-actions');
      const editBtn = el('button', 'btn small', '编辑');
      editBtn.addEventListener('click', () => openForm(c));
      const delBtn = el('button', 'btn small danger', '删除');
      delBtn.addEventListener('click', async () => {
        state.commands = await api.removeCommand(c.id);
        refreshCommands();
        toast('已删除');
      });
      actionsEl.append(editBtn, delBtn);
      li.appendChild(actionsEl);

      list.appendChild(li);
    }
  }

  cmdWidgets.push(render);
}

function refreshCommands() {
  cmdWidgets.forEach((render) => render());
}

// ---------- 提醒管理组件（气泡 Tab 与双击面板复用） ----------
const remWidgets = [];

function createReminderWidget(container) {
  container.innerHTML = '';

  const addBtn = el('button', 'btn add', '+ 新增提醒');
  const form = el('div', 'form hidden');
  const typeSel = el('select', 'input');
  const optAbs = el('option', '', '⏰ 定点提醒');
  optAbs.value = 'absolute';
  const optInt = el('option', '', '🔁 周期提醒');
  optInt.value = 'interval';
  typeSel.append(optAbs, optInt);
  const timeInput = el('input', 'input');
  timeInput.type = 'time';
  const intervalInput = el('input', 'input hidden');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.max = '1440';
  intervalInput.placeholder = '间隔（分钟）';
  const textInput = el('input', 'input');
  textInput.placeholder = '提醒内容（如：喝水）';
  textInput.maxLength = 60;
  const actions = el('div', 'form-actions');
  const saveBtn = el('button', 'btn primary small', '保存');
  const cancelBtn = el('button', 'btn small', '取消');
  actions.append(saveBtn, cancelBtn);
  form.append(typeSel, timeInput, intervalInput, textInput, actions);
  const list = el('ul', 'list');
  container.append(addBtn, form, list);

  let editingId = null;

  typeSel.addEventListener('change', () => {
    timeInput.classList.toggle('hidden', typeSel.value !== 'absolute');
    intervalInput.classList.toggle('hidden', typeSel.value !== 'interval');
  });

  function openForm(r) {
    editingId = r ? r.id : null;
    typeSel.value = r ? r.type : 'absolute';
    typeSel.dispatchEvent(new Event('change'));
    timeInput.value = r && r.time ? r.time : '';
    intervalInput.value = r && r.intervalMin ? String(r.intervalMin) : '';
    textInput.value = r ? r.text : '';
    form.classList.remove('hidden');
    addBtn.classList.add('hidden');
  }
  function closeForm() {
    editingId = null;
    form.classList.add('hidden');
    addBtn.classList.remove('hidden');
  }

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', closeForm);
  saveBtn.addEventListener('click', async () => {
    const type = typeSel.value;
    const text = textInput.value.trim();
    if (!text) return toast('请填写提醒内容');
    const old = editingId ? state.reminders.find((r) => r.id === editingId) : null;
    const reminder = {
      id: editingId || newId('r'),
      type,
      text,
      enabled: old ? old.enabled : true,
      preset: old ? old.preset : undefined
    };
    if (type === 'absolute') {
      if (!timeInput.value) return toast('请选择提醒时刻');
      reminder.time = timeInput.value;
    } else {
      const minutes = Number(intervalInput.value);
      if (!minutes || minutes < 1) return toast('请填写间隔分钟数（≥1）');
      reminder.intervalMin = Math.round(minutes);
    }
    state.reminders = editingId
      ? await api.updateReminder(reminder)
      : await api.addReminder(reminder);
    closeForm();
    refreshReminders();
    toast('已保存');
  });

  function render() {
    list.innerHTML = '';
    for (const r of state.reminders) {
      const li = el('li', 'list-item');
      li.appendChild(el('span', 'rem-badge', r.type === 'absolute' ? '⏰' : '🔁'));

      const main = el('div', 'item-main');
      main.appendChild(el('div', 'rem-text', r.text));
      main.appendChild(el(
        'div', 'rem-meta',
        r.type === 'absolute' ? `每天 ${r.time}` : `每 ${r.intervalMin} 分钟`
      ));

      const enableBox = el('input');
      enableBox.type = 'checkbox';
      enableBox.checked = r.enabled;
      enableBox.title = '启用/停用';
      enableBox.addEventListener('change', async () => {
        state.reminders = await api.updateReminder({ ...r, enabled: enableBox.checked });
        refreshReminders();
      });

      const actionsEl = el('div', 'item-actions');
      const editBtn = el('button', 'btn small', '编辑');
      editBtn.addEventListener('click', () => openForm(r));
      const delBtn = el('button', 'btn small danger', '删除');
      delBtn.addEventListener('click', async () => {
        state.reminders = await api.removeReminder(r.id);
        refreshReminders();
        toast('已删除');
      });
      actionsEl.append(editBtn, delBtn);

      li.append(main, enableBox, actionsEl);
      list.appendChild(li);
    }
  }

  remWidgets.push({ render });
  return { render };
}

function refreshReminders() {
  remWidgets.forEach((w) => w.render());
}
function refreshAll() {
  refreshCommands();
  refreshReminders();
}

// ---------- 提醒触发表现：动画 + 提示音 + 气泡 三合一 ----------
let notifyTimer = null;

api.onReminder(({ text }) => {
  playNotifySound();
  setPetState('remind');
  $('#notify-text').textContent = text;
  $('#notify-bubble').classList.remove('hidden');
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(hideNotifyBubble, 8000); // 8 秒自动消失
});

function hideNotifyBubble() {
  $('#notify-bubble').classList.add('hidden');
  clearTimeout(notifyTimer);
  setPetState('idle');
}
$('#notify-ok').addEventListener('click', hideNotifyBubble);

// WebAudio 合成双音提示音（A5 → D6，正弦波，无需素材文件）
function playNotifySound() {
  try {
    const ctx = new AudioContext();
    const volume = 0.8;
    [[880, 0], [1174.66, 0.18]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35 * volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch (e) {
    // 音频不可用时静默降级，不影响视觉提醒
  }
}

// ---------- 配置中心窗口拖动（仅配置窗口） ----------
// 按住面板头部拖动整个窗口：复用主进程绝对锚点拖动（坐标由主进程采集，多屏不漂移）
function wireConfigDrag() {
  const header = $('.panel-header');
  header.classList.add('drag-handle');
  let cfgDragging = false;
  let cfgMoved = false;
  let cfgSX = 0;
  let cfgSY = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .tabs')) return; // Tab 栏与关闭按钮不参与拖动
    cfgDragging = true;
    cfgMoved = false;
    cfgSX = e.screenX;
    cfgSY = e.screenY;
    api.dragStart();
  });
  document.addEventListener('mousemove', (e) => {
    if (!cfgDragging) return;
    if ((e.buttons & 1) === 0) {
      // 左键已松开但 mouseup 丢失，兜底结束拖动
      cfgDragging = false;
      api.dragEnd();
      return;
    }
    if (e.screenX !== cfgSX || e.screenY !== cfgSY) cfgMoved = true;
    if (cfgMoved) api.dragTo();
  });
  document.addEventListener('mouseup', () => {
    if (!cfgDragging) return;
    cfgDragging = false;
    api.dragEnd();
  });
  window.addEventListener('blur', () => {
    if (cfgDragging) {
      cfgDragging = false;
      api.dragEnd();
    }
  });
}

// ---------- 初始化 ----------
async function loadData() {
  try {
    const data = await api.getAll();
    state.reminders = data.reminders || [];
    state.commands = data.commands || [];
  } catch (e) {
    state = { reminders: [], commands: [] };
  }
}

async function init() {
  if (isConfigWindow) {
    // 配置中心独立窗口：只显示配置面板（无宠物/气泡/通知），Esc 或 ✕ 关窗
    $('#pet').classList.add('hidden');
    $('#bubble').classList.add('hidden');
    $('#notify-bubble').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    createCommandWidget($('#cmd-widget-panel'));
    createReminderWidget($('#rem-widget-panel'));
    wireConfigDrag(); // 面板头部可拖动窗口
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') api.setConfigOpen(false);
    });
  } else {
    // 宠物窗口：右键交互面板（对话）+ 监听配置窗口数据变更实时同步
    api.onDataChanged(async () => {
      await loadData();
      refreshAll();
    });
  }
  await loadData();
  refreshAll();
}
init();
