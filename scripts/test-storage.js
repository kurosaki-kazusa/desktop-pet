// scripts/test-storage.js · main/storage.js schema v3 迁移单测（P3-M0）
// 用法：npm run test:storage  或  node scripts/test-storage.js
// 覆盖：旧 commands → entries（pinned/quick 保留、归入默认空间）、reminders 原样保留、
//       settings 补默认值、失败不落盘不删旧字段（回滚）、幂等（已是 v3 只补默认）、
//       旧命令 UI 映射辅助（commandsFromEntries/entryFromCommand/applyCommandToEntry）
'use strict';

const assert = require('assert');
const path = require('path');
const S = require('../main/storage.js');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 内存 mock store：实现 get/set/has/delete 即可（与 electron-store 接口兼容，
// get 未命中返回 undefined 而非抛错——测试不传 defaults，模拟真实 store 旧数据场景）
function mockStore(initial) {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    has: (k) => Object.prototype.hasOwnProperty.call(data, k),
    delete: (k) => { delete data[k]; },
    _data: data
  };
}

// 模拟二期用户数据（含 v2.0 之前的 quick 旧字段与 pinned 混存）
function legacyData() {
  return {
    commands: [
      { id: 'c1', title: '清缓存', content: 'npm cache clean --force', pinned: true },
      { id: 'c2', title: '多行脚本', content: 'git add .\ngit commit -m "x"\ngit push', quick: true, pinned: false },
      { id: 'c3', title: '启动项目', content: 'npm run dev' }
    ],
    reminders: [
      { id: 'preset-usage', type: 'interval', intervalMin: 60, text: '已使用电脑 1 小时，起来活动一下、喝口水', enabled: true, preset: 'usage' },
      { id: 'r2', type: 'absolute', time: '14:30', text: '开会', enabled: false }
    ],
    settings: { windowPos: { x: 100, y: 200 }, volume: 0.5, chat: { apiKey: 'sk-old' }, alwaysOnTop: false },
    chat: { history: [{ role: 'user', content: 'hi' }] },
    seeded: true,
    posSchemaV2: true
  };
}

function main() {
  // ---------- 1. 旧数据一次性迁移 ----------
  {
    const store = mockStore(legacyData());
    const r = S.migrate(store);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.migrated, true);
    const d = store._data;

    // 空间：默认「常用命令」空间创建
    assert.strictEqual(d.spaces.length, 1);
    assert.strictEqual(d.spaces[0].id, S.DEFAULT_SPACE_ID);
    assert.strictEqual(d.spaces[0].name, '常用命令');
    assert.strictEqual(typeof d.spaces[0].createdAt, 'number');

    // entries：全部旧命令转换，pinned 保留（quick=true 视为 pinned）、type=command、归入默认空间
    assert.strictEqual(d.entries.length, 3);
    const c1 = d.entries.find((e) => e.id === 'c1');
    const c2 = d.entries.find((e) => e.id === 'c2');
    const c3 = d.entries.find((e) => e.id === 'c3');
    assert.strictEqual(c1.pinned, true, '旧 pinned=true 保留');
    assert.strictEqual(c2.pinned, true, '旧 quick=true 迁移为 pinned=true');
    assert.strictEqual(c3.pinned, false, '无标记命令不置顶');
    d.entries.forEach((e) => {
      assert.strictEqual(e.type, 'command');
      assert.strictEqual(e.spaceId, S.DEFAULT_SPACE_ID);
      assert.strictEqual(e.coverId, null);
      assert.ok(Number.isFinite(e.createdAt));
      assert.ok(Number.isFinite(e.updatedAt));
    });
    assert.strictEqual(c2.content, 'git add .\ngit commit -m "x"\ngit push', '多行正文原样保留');

    // reminders：原样保留（不转任务）
    assert.deepStrictEqual(d.reminders, legacyData().reminders);
    assert.deepStrictEqual(d.tasks, []);
    assert.deepStrictEqual(d.notes, []);

    // settings：旧值保留 + 三期新字段补默认
    assert.deepStrictEqual(d.settings.windowPos, { x: 100, y: 200 });
    assert.strictEqual(d.settings.volume, 0.5);
    assert.strictEqual(d.settings.alwaysOnTop, false, '旧 alwaysOnTop=false 保留');
    assert.deepStrictEqual(d.settings.chat, { apiKey: 'sk-old', baseUrl: '', model: '', systemPrompt: '' }, '旧 chat 配置补齐字段');
    assert.strictEqual(d.settings.defaultPage, 'prompts');
    assert.strictEqual(d.settings.launchAtLogin, false);
    assert.strictEqual(d.settings.reducedMotion, false);
    assert.deepStrictEqual(d.settings.workspaceWindow, { bounds: null, maximized: false, lastPage: 'prompts' });

    // 版本号与旧字段
    assert.strictEqual(d.schemaVersion, S.SCHEMA_VERSION, '校验通过后写入 schemaVersion');
    assert.ok(Array.isArray(d.commands), '旧 commands 字段保留（兼容读取一个版本周期）');
    assert.deepStrictEqual(d.chat.history, [{ role: 'user', content: 'hi' }], 'chat.history 不受迁移影响');
    assert.strictEqual(d.seeded, true);

    // 迁移前备份存在（含时间戳与旧三表）
    assert.ok(d.backupSchemaV2);
    assert.ok(Number.isFinite(d.backupSchemaV2.savedAt));
    assert.deepStrictEqual(d.backupSchemaV2.commands, legacyData().commands);
    assert.deepStrictEqual(d.backupSchemaV2.reminders, legacyData().reminders);
    assert.deepStrictEqual(d.backupSchemaV2.settings, legacyData().settings);

    ok('旧 commands → entries（pinned/quick 保留、默认空间）+ reminders/settings 原样/补默认 + 备份存在');
  }

  // ---------- 2. 迁移失败（中途写入出错，如磁盘 EPERM/EBUSY）：不写 schemaVersion、不删旧字段（回滚） ----------
  {
    const initial = legacyData();
    // 模拟磁盘写入故障：写 entries 键时抛错（此时 spaces 已写入、reminders/settings 未覆盖）
    const base = mockStore(initial);
    const store = {
      get: base.get,
      has: base.has,
      delete: base.delete,
      set: (k, v) => {
        if (k === 'entries') throw new Error('EPERM: 磁盘写入被拒');
        base.set(k, v);
      },
      _data: base._data
    };
    const r = S.migrate(store);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error, '返回失败原因');
    const d = store._data;
    assert.strictEqual(d.schemaVersion, undefined, '失败不写 schemaVersion');
    assert.ok(Array.isArray(d.commands), '失败不删除旧 commands 字段');
    assert.deepStrictEqual(d.commands, initial.commands, '旧 commands 内容原样');
    assert.deepStrictEqual(d.reminders, initial.reminders, '旧 reminders 原样');
    assert.strictEqual(d.settings.volume, 0.5, '旧 settings 原样（未被迁移值覆盖）');
    assert.strictEqual(d.settings.defaultPage, undefined, '旧 settings 未被混入新字段');
    assert.ok(d.backupSchemaV2, '备份仍保留（供人工恢复）');
    ok('迁移失败：不写 schemaVersion、不删旧字段、备份保留');
  }

  // ---------- 3. 回滚清掉迁移中途写入的新键 ----------
  {
    const initial = legacyData();
    const base = mockStore(initial);
    const store = {
      get: base.get,
      has: base.has,
      delete: base.delete,
      set: (k, v) => {
        if (k === 'entries') throw new Error('EPERM');
        base.set(k, v);
      },
      _data: base._data
    };
    S.migrate(store);
    const d = store._data;
    assert.strictEqual(d.spaces, undefined, '迁移中途写入的 spaces 被回滚删除');
    assert.strictEqual(d.entries, undefined, '迁移中途写入的 entries 被回滚删除');
    assert.strictEqual(d.notes, undefined, '迁移中途写入的 notes 被回滚删除');
    assert.strictEqual(d.tasks, undefined, '迁移中途写入的 tasks 被回滚删除');
    ok('回滚：迁移前不存在的新键被删除，不留半截数据');
  }

  // ---------- 4. 幂等：已是 v3 只补默认字段 ----------
  {
    const store = mockStore({
      schemaVersion: 3,
      spaces: [{ id: 'space-commands', name: '常用命令', order: 0, createdAt: 1 }],
      entries: [{ id: 'e1', spaceId: 'space-commands', type: 'prompt', title: 't', content: 'c', coverId: null, pinned: false, createdAt: 1, updatedAt: 1 }],
      reminders: [{ id: 'r1', type: 'interval', intervalMin: 60, text: 'x', enabled: true }],
      settings: { volume: 0.3 }
    });
    const r = S.migrate(store);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.migrated, false);
    assert.strictEqual(r.alreadyV3, true);
    const d = store._data;
    assert.strictEqual(d.notes.length, 0, '缺失的 notes 补空数组');
    assert.strictEqual(d.tasks.length, 0, '缺失的 tasks 补空数组');
    assert.strictEqual(d.settings.volume, 0.3, '已有 settings 值不被覆盖');
    assert.strictEqual(d.settings.defaultPage, 'prompts', '缺失的三期字段补默认');
    assert.strictEqual(d.backupSchemaV2, undefined, 'v3 不重复备份');
    ok('幂等：schemaVersion>=3 只补默认字段，不重复迁移/备份');
  }

  // ---------- 5. 空数据全新安装（无旧命令） ----------
  {
    const store = mockStore({});
    const r = S.migrate(store);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.migrated, true);
    assert.strictEqual(r.entryCount, 0);
    assert.strictEqual(store._data.entries.length, 0);
    assert.strictEqual(store._data.spaces.length, 1);
    assert.strictEqual(store._data.schemaVersion, 3);
    ok('全新安装：空 commands 迁移为空 entries + 默认空间');
  }

  // ---------- 6. 旧命令 UI 映射辅助（过渡期 command:* IPC 复用） ----------
  {
    const entries = [
      { id: 'e1', spaceId: 'space-commands', type: 'command', title: 'a', content: 'x', coverId: null, pinned: true, createdAt: 1, updatedAt: 1 },
      { id: 'e2', spaceId: 'space-commands', type: 'prompt', title: 'p', content: 'y', coverId: null, pinned: false, createdAt: 1, updatedAt: 1 },
      { id: 'e3', spaceId: 'space-commands', type: 'command', title: 'b', content: 'z', coverId: null, pinned: false, createdAt: 1, updatedAt: 2 }
    ];
    const cmds = S.commandsFromEntries(entries);
    assert.strictEqual(cmds.length, 2, '只映射 type=command');
    assert.deepStrictEqual(cmds[0], { id: 'e1', title: 'a', content: 'x', pinned: true });

    const entry = S.entryFromCommand({ id: 'new-1', title: 't', content: 'c', pinned: true });
    assert.strictEqual(entry.type, 'command');
    assert.strictEqual(entry.spaceId, S.DEFAULT_SPACE_ID);
    assert.strictEqual(entry.coverId, null);
    assert.ok(Number.isFinite(entry.createdAt) && Number.isFinite(entry.updatedAt));

    const updated = S.applyCommandToEntry({ ...entries[2], coverId: 'cover-x' }, { title: 'b2', content: 'z2', pinned: true });
    assert.strictEqual(updated.title, 'b2');
    assert.strictEqual(updated.content, 'z2');
    assert.strictEqual(updated.pinned, true);
    assert.strictEqual(updated.coverId, 'cover-x', '保留三期封面字段');
    assert.strictEqual(updated.spaceId, 'space-commands', '保留空间归属');
    assert.ok(updated.updatedAt >= entries[2].updatedAt);
    ok('映射辅助：commandsFromEntries / entryFromCommand / applyCommandToEntry');
  }

  // ---------- 7. mergeSettings 默认值完整性 ----------
  {
    const s = S.mergeSettings(undefined);
    assert.deepStrictEqual(s, S.SETTINGS_DEFAULTS);
    assert.strictEqual(S.SETTINGS_DEFAULTS.defaultPage, 'prompts');
    ok('mergeSettings：空输入返回完整默认值');
  }

  console.log(`\n全部通过：${passed} 项`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error('\n测试失败：', e);
  process.exit(1);
}
