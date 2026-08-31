// P3-M4~M6 内容数据层测试：纯内存 store + Electron API 桩，不读写真实用户数据。
const assert = require('assert');
const Module = require('module');
const { DEFAULT_SPACE_ID, DEFAULT_NOTE_SPACE_ID } = require('../main/storage');
const { isIsoDate, shouldMapRangeTask, isAbsoluteReminderDue } = require('../task-rules');

class MemoryStore {
  constructor(data) { this.data = JSON.parse(JSON.stringify(data)); }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = JSON.parse(JSON.stringify(value)); }
}

const handlers = new Map();
const fakeElectron = {
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  clipboard: { writeImage: () => {} },
  nativeImage: {
    createFromDataURL: () => ({ isEmpty: () => false }),
    createFromPath: () => ({ isEmpty: () => false })
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};
const content = require('../main/content');
Module._load = originalLoad;

const now = 1000;
const store = new MemoryStore({
  spaces: [
    { id: DEFAULT_SPACE_ID, name: '常用命令', order: 0, createdAt: now },
    { id: 'space-project', name: '课程', order: 1, createdAt: now }
  ],
  noteSpaces: [
    { id: DEFAULT_NOTE_SPACE_ID, name: '默认记事', order: 0, createdAt: now },
    { id: 'note-space-project', name: '笔记课程', order: 1, createdAt: now }
  ],
  entries: [{ id: 'entry-1', type: 'prompt', spaceId: 'space-project', title: '条目', content: '正文', createdAt: now, updatedAt: now }],
  notes: [{ id: 'note-old', spaceId: 'note-space-project', title: '旧笔记', content: '内容', createdAt: now, updatedAt: now }],
  tasks: [],
  reminders: []
});
content.init(store);

const event = { sender: {} };
const call = (name, ...args) => {
  const handler = handlers.get(name);
  assert(handler, `未注册 IPC：${name}`);
  return handler(event, ...args);
};

function ok(label, fn) {
  fn();
  console.log(`  ✓ ${label}`);
}

ok('workspace 快照包含 notes', () => {
  const data = call('workspace:get-data');
  assert.equal(data.notes.length, 1);
  assert.equal(data.noteSpaces.length, 2);
});

ok('提示词与记事本空间创建互不影响', () => {
  let res = call('space:create', { name: '仅提示词', scope: 'prompts' });
  assert(res.spaces.some((item) => item.name === '仅提示词'));
  assert(!res.noteSpaces.some((item) => item.name === '仅提示词'));
  res = call('space:create', { name: '仅记事本', scope: 'notes' });
  assert(res.noteSpaces.some((item) => item.name === '仅记事本'));
  assert(!res.spaces.some((item) => item.name === '仅记事本'));
});

let createdId;
ok('零配置创建空白记事本并归入指定空间', () => {
  const res = call('note:create', { spaceId: 'note-space-project' });
  assert.equal(res.ok, true);
  createdId = res.noteId;
  const note = res.notes.find((item) => item.id === createdId);
  assert(note);
  assert.equal(note.spaceId, 'note-space-project');
  assert.equal(note.title, '');
  assert.equal(note.content, '');
});

ok('自动保存入口更新标题正文并保留 createdAt', () => {
  const before = store.get('notes').find((item) => item.id === createdId).createdAt;
  const res = call('note:save', { id: createdId, title: '  灵感记录  ', content: '第一行\n第二行' });
  const note = res.notes.find((item) => item.id === createdId);
  assert.equal(note.title, '灵感记录');
  assert.equal(note.content, '第一行\n第二行');
  assert.equal(note.createdAt, before);
  assert(note.updatedAt >= before);
});

ok('记事本正文 100000 字上限由主进程拦截', () => {
  const res = call('note:save', { id: createdId, title: '', content: 'x'.repeat(100001) });
  assert.equal(res.ok, false);
  assert.match(res.error, /100000/);
});

ok('非空空间未选择策略时拒绝删除', () => {
  const res = call('space:delete', { id: 'space-project' });
  assert.equal(res.ok, false);
});

ok('提示词空间迁移只影响 entries，不影响 notes', () => {
  const noteTime = store.get('notes').find((item) => item.id === 'note-old').updatedAt;
  const res = call('space:delete', { id: 'space-project', strategy: 'migrate' });
  assert.equal(res.ok, true);
  assert(res.entries.every((item) => item.spaceId === DEFAULT_SPACE_ID));
  assert.equal(res.notes.find((item) => item.id === 'note-old').spaceId, 'note-space-project');
  assert.equal(res.notes.find((item) => item.id === 'note-old').updatedAt, noteTime);
});

let purgeSpaceId;
ok('一并删除记事空间时只清除其中笔记', () => {
  let res = call('space:create', { name: '待清除', scope: 'notes' });
  purgeSpaceId = res.noteSpaces.find((item) => item.name === '待清除').id;
  res = call('note:create', { spaceId: purgeSpaceId });
  const purgeNoteId = res.noteId;
  const entryCount = res.entries.length;
  res = call('space:delete', { id: purgeSpaceId, strategy: 'purge', scope: 'notes' });
  assert.equal(res.ok, true);
  assert(!res.notes.some((item) => item.id === purgeNoteId));
  assert.equal(res.entries.length, entryCount);
});

ok('删除记事本后快照同步更新', () => {
  const res = call('note:delete', createdId);
  assert.equal(res.ok, true);
  assert(!res.notes.some((item) => item.id === createdId));
});

ok('日期校验拒绝伪日期', () => {
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-2-3'), false);
});

ok('高优先级长期任务在完整闭区间映射', () => {
  const task = { kind: 'range', priority: 'high', startDate: '2026-08-01', endDate: '2026-08-10', completed: false };
  assert.equal(shouldMapRangeTask(task, '2026-08-01'), true);
  assert.equal(shouldMapRangeTask(task, '2026-08-10'), true);
  assert.equal(shouldMapRangeTask(task, '2026-07-31'), false);
  assert.equal(shouldMapRangeTask(task, '2026-08-11'), false);
});

ok('普通与低优先级仅在结束日前最后 7 天映射', () => {
  for (const priority of ['normal', 'low']) {
    const task = { kind: 'range', priority, startDate: '2026-08-01', endDate: '2026-08-10', completed: false };
    assert.equal(shouldMapRangeTask(task, '2026-08-03'), false);
    assert.equal(shouldMapRangeTask(task, '2026-08-04'), true);
    assert.equal(shouldMapRangeTask(task, '2026-08-10'), true);
  }
});

let rangeTaskId;
ok('新增长期待办并校验日期区间', () => {
  let res = call('task:save', { kind: 'range', title: '  开发课程  ', notes: '完成课件', priority: 'high', startDate: '2026-08-01', endDate: '2026-08-10' });
  assert.equal(res.ok, true);
  const task = res.tasks.find((item) => item.title === '开发课程');
  rangeTaskId = task.id;
  assert.equal(task.completed, false);
  assert.equal(task.reminderId, null);
  res = call('task:save', { kind: 'range', title: '错误区间', priority: 'normal', startDate: '2026-08-10', endDate: '2026-08-01' });
  assert.equal(res.ok, false);
});

let todayTaskId;
ok('新增当日事项且时间为可选项', () => {
  let res = call('task:save', { kind: 'today', title: '全天事项', notes: '', priority: 'normal', date: '2026-08-28', time: '' });
  assert.equal(res.ok, true);
  todayTaskId = res.tasks.find((item) => item.title === '全天事项').id;
  res = call('task:save', { kind: 'today', title: '定时事项', priority: 'low', date: '2026-08-28', time: '25:00' });
  assert.equal(res.ok, false);
});

ok('编辑时禁止切换任务类型', () => {
  const res = call('task:save', { id: rangeTaskId, kind: 'today', title: '切换类型', priority: 'normal', date: '2026-08-28', time: '' });
  assert.equal(res.ok, false);
  assert.match(res.error, /不可修改/);
});

ok('完成任务后映射规则立即排除', () => {
  const res = call('task:toggle-complete', { id: rangeTaskId, completed: true });
  const task = res.tasks.find((item) => item.id === rangeTaskId);
  assert.equal(task.completed, true);
  assert.equal(shouldMapRangeTask(task, '2026-08-05'), false);
});

ok('删除任务后快照同步更新', () => {
  const res = call('task:delete', todayTaskId);
  assert.equal(res.ok, true);
  assert(!res.tasks.some((item) => item.id === todayTaskId));
});

ok('定点提醒只在绑定日期与时刻命中，旧版无日期提醒保持每日兼容', () => {
  const dated = { type: 'absolute', date: '2026-08-28', time: '09:00', enabled: true };
  assert.equal(isAbsoluteReminderDue(dated, '2026-08-28', '09:00'), true);
  assert.equal(isAbsoluteReminderDue(dated, '2026-08-29', '09:00'), false);
  assert.equal(isAbsoluteReminderDue({ ...dated, date: undefined }, '2026-08-29', '09:00'), true);
});

let standaloneReminderId;
ok('提醒管理新增定点提醒并严格校验日期时间', () => {
  let res = call('workspace-reminder:save', { type: 'absolute', text: '课程同步', date: '2026-08-30', time: '16:30', enabled: true });
  assert.equal(res.ok, true);
  const reminder = res.reminders.find((item) => item.text === '课程同步');
  standaloneReminderId = reminder.id;
  assert.equal(reminder.linkedTaskId, null);
  res = call('workspace-reminder:save', { type: 'absolute', text: '伪日期', date: '2026-02-30', time: '16:30' });
  assert.equal(res.ok, false);
});

ok('周期与使用时长提醒校验分钟范围', () => {
  assert.equal(call('workspace-reminder:save', { type: 'interval', text: '喝水', intervalMin: 50 }).ok, true);
  assert.equal(call('workspace-reminder:save', { type: 'usage', text: '起来活动', intervalMin: 60 }).ok, true);
  assert.equal(call('workspace-reminder:save', { type: 'interval', text: '错误间隔', intervalMin: 0 }).ok, false);
});

let linkedTaskId;
ok('任务勾选提醒后原子创建关联定点提醒', () => {
  const res = call('task:save', { kind: 'today', title: '录制演示', date: '2026-08-31', time: '15:20', priority: 'high', reminderEnabled: true });
  assert.equal(res.ok, true);
  const task = res.tasks.find((item) => item.title === '录制演示');
  linkedTaskId = task.id;
  const reminder = res.reminders.find((item) => item.id === task.reminderId);
  assert(reminder);
  assert.equal(reminder.linkedTaskId, task.id);
  assert.equal(reminder.date, '2026-08-31');
  assert.equal(reminder.time, '15:20');
});

ok('编辑任务时关联提醒日期、时间与标题同步', () => {
  const before = store.get('tasks').find((item) => item.id === linkedTaskId);
  call('workspace-reminder:toggle', { id: before.reminderId, enabled: false });
  const res = call('task:save', { id: linkedTaskId, kind: 'today', title: '录制正式演示', date: '2026-09-01', time: '', priority: 'normal', reminderEnabled: true });
  const task = res.tasks.find((item) => item.id === linkedTaskId);
  const reminder = res.reminders.find((item) => item.id === task.reminderId);
  assert.equal(reminder.text, '录制正式演示');
  assert.equal(reminder.date, '2026-09-01');
  assert.equal(reminder.time, '09:00');
  assert.equal(reminder.enabled, false);
});

ok('删除关联提醒保留任务并解除双向关联', () => {
  const task = store.get('tasks').find((item) => item.id === linkedTaskId);
  const res = call('workspace-reminder:delete', task.reminderId);
  assert.equal(res.ok, true);
  assert.equal(res.tasks.find((item) => item.id === linkedTaskId).reminderId, null);
});

ok('删除任务时可选择保留或一并删除关联提醒', () => {
  let res = call('task:save', { kind: 'range', title: '保留提醒任务', startDate: '2026-09-01', endDate: '2026-09-05', priority: 'normal', reminderEnabled: true });
  let task = res.tasks.find((item) => item.title === '保留提醒任务');
  const keptReminderId = task.reminderId;
  assert.equal(call('task:delete', { id: task.id }).ok, false);
  res = call('task:delete', { id: task.id, reminderStrategy: 'keep' });
  assert.equal(res.reminders.find((item) => item.id === keptReminderId).linkedTaskId, null);
  res = call('task:save', { kind: 'range', title: '一并删除任务', startDate: '2026-09-01', endDate: '2026-09-05', priority: 'high', reminderEnabled: true });
  task = res.tasks.find((item) => item.title === '一并删除任务');
  const deletedReminderId = task.reminderId;
  res = call('task:delete', { id: task.id, reminderStrategy: 'delete' });
  assert(!res.reminders.some((item) => item.id === deletedReminderId));
  assert(res.reminders.some((item) => item.id === standaloneReminderId));
});

console.log('\n全部通过：24 项');
