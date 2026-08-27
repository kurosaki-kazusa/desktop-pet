// P3-M4 内容数据层测试：纯内存 store + Electron API 桩，不读写真实用户数据。
const assert = require('assert');
const Module = require('module');
const { DEFAULT_SPACE_ID } = require('../main/storage');

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
  entries: [{ id: 'entry-1', type: 'prompt', spaceId: 'space-project', title: '条目', content: '正文', createdAt: now, updatedAt: now }],
  notes: [{ id: 'note-old', spaceId: 'space-project', title: '旧笔记', content: '内容', createdAt: now, updatedAt: now }]
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
});

let createdId;
ok('零配置创建空白记事本并归入指定空间', () => {
  const res = call('note:create', { spaceId: 'space-project' });
  assert.equal(res.ok, true);
  createdId = res.noteId;
  const note = res.notes.find((item) => item.id === createdId);
  assert(note);
  assert.equal(note.spaceId, 'space-project');
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

ok('迁移空间时 entries 与 notes 同步迁移且不改更新时间', () => {
  const noteTime = store.get('notes').find((item) => item.id === 'note-old').updatedAt;
  const res = call('space:delete', { id: 'space-project', strategy: 'migrate' });
  assert.equal(res.ok, true);
  assert(res.entries.every((item) => item.spaceId === DEFAULT_SPACE_ID));
  assert(res.notes.every((item) => item.spaceId === DEFAULT_SPACE_ID));
  assert.equal(res.notes.find((item) => item.id === 'note-old').updatedAt, noteTime);
});

let purgeSpaceId;
ok('一并删除空间时其中记事本同步清除', () => {
  let res = call('space:create', { name: '待清除' });
  purgeSpaceId = res.spaces.find((item) => item.name === '待清除').id;
  res = call('note:create', { spaceId: purgeSpaceId });
  const purgeNoteId = res.noteId;
  res = call('space:delete', { id: purgeSpaceId, strategy: 'purge' });
  assert.equal(res.ok, true);
  assert(!res.notes.some((item) => item.id === purgeNoteId));
});

ok('删除记事本后快照同步更新', () => {
  const res = call('note:delete', createdId);
  assert.equal(res.ok, true);
  assert(!res.notes.some((item) => item.id === createdId));
});

console.log('\n全部通过：8 项');
