// main/storage.js · schema v4 数据底座（v4：提示词与记事本空间分离）
// 职责：数据模型常量、旧数据一次性迁移（备份 → 转换 → 校验 → 落盘 → 写版本号）、
//       失败回滚（不写 schemaVersion、不删旧字段）、默认值补齐、旧命令 UI 映射辅助。
// 纯 Node 模块：不依赖 Electron API，store 参数只需实现 { get, set, has, delete }，
// 便于 scripts/test-storage.js 用内存 mock 做单测（与 chat.js 同样的零依赖原则）。

'use strict';

const SCHEMA_VERSION = 4;

// 默认项目空间：旧命令全部归入该空间（产品方案 §9 迁移规则）
const DEFAULT_SPACE_ID = 'space-commands';
const DEFAULT_SPACE_NAME = '常用命令';
const DEFAULT_NOTE_SPACE_ID = 'note-space-default';
const DEFAULT_NOTE_SPACE_NAME = '默认记事';

// settings 默认值：workspaceWindow/defaultPage/launchAtLogin/reducedMotion/uiFontSize 为三期新增，
// volume/alwaysOnTop/chat/windowPos 沿用二期语义
const SETTINGS_DEFAULTS = {
  windowPos: null,
  volume: 0.8,
  chat: { apiKey: '', baseUrl: '', model: '', systemPrompt: '' },
  alwaysOnTop: true,
  workspaceWindow: { bounds: null, maximized: false, lastPage: 'prompts' },
  defaultPage: 'prompts',
  uiFontSize: 16,
  launchAtLogin: false,
  reducedMotion: false
};

function defaultSpace(now) {
  return { id: DEFAULT_SPACE_ID, name: DEFAULT_SPACE_NAME, order: 0, createdAt: now };
}

function defaultNoteSpace(now) {
  return { id: DEFAULT_NOTE_SPACE_ID, name: DEFAULT_NOTE_SPACE_NAME, order: 0, createdAt: now };
}

function toArray(v) {
  return Array.isArray(v) ? v : [];
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// 深合并 settings：旧值优先，仅补缺失字段（chat/workspaceWindow 单独合并，不整体覆盖）
function mergeSettings(old) {
  const s = plainObject(old);
  return {
    ...SETTINGS_DEFAULTS,
    ...s,
    chat: { ...SETTINGS_DEFAULTS.chat, ...plainObject(s.chat) },
    workspaceWindow: { ...SETTINGS_DEFAULTS.workspaceWindow, ...plainObject(s.workspaceWindow) }
  };
}

function normalizeSettingsPatch(current, patch) {
  const base = mergeSettings(plainObject(current));
  const d = plainObject(patch);
  if (d.defaultPage != null && !['notes', 'prompts'].includes(d.defaultPage)) return { error: '默认打开界面无效' };
  if (d.uiFontSize != null && ![16, 18, 20].includes(Number(d.uiFontSize))) return { error: '界面字号无效' };
  if (d.volume != null && (!Number.isFinite(Number(d.volume)) || Number(d.volume) < 0 || Number(d.volume) > 1)) {
    return { error: '提醒音量须在 0 到 1 之间' };
  }
  const value = { ...base };
  if (d.defaultPage != null) value.defaultPage = d.defaultPage;
  if (d.uiFontSize != null) value.uiFontSize = Number(d.uiFontSize);
  if (d.volume != null) value.volume = Number(d.volume);
  for (const key of ['alwaysOnTop', 'launchAtLogin', 'reducedMotion']) {
    if (d[key] != null) {
      if (typeof d[key] !== 'boolean') return { error: `${key} 必须为布尔值` };
      value[key] = d[key];
    }
  }
  return { value };
}

function toPublicChatSettings(chatSettings, envApiKeyConfigured) {
  const chat = { ...SETTINGS_DEFAULTS.chat, ...plainObject(chatSettings) };
  return {
    apiKey: '',
    apiKeyConfigured: Boolean(chat.apiKey || envApiKeyConfigured),
    storedApiKeyConfigured: Boolean(chat.apiKey),
    baseUrl: chat.baseUrl,
    model: chat.model,
    systemPrompt: chat.systemPrompt
  };
}

// 旧命令 → schema v3 entry：标题/正文/pinned 原样保留（含 v2.0 之前的 quick 字段兼容），
// type 固定为 command，归入默认「常用命令」空间
function entriesFromCommands(commands, now) {
  return toArray(commands).map((c, i) => {
    const created = Number(c.createdAt) || now;
    return {
      id: String((c && c.id) || `entry-${i + 1}`),
      spaceId: DEFAULT_SPACE_ID,
      type: 'command',
      title: String((c && c.title) || ''),
      content: String((c && c.content) || ''),
      coverId: null,
      pinned: (c && (c.pinned === true || c.quick === true)) === true,
      createdAt: created,
      updatedAt: Number(c.updatedAt) || created
    };
  });
}

// entries → 旧命令 UI 形态（P3-M0 过渡期：配置中心仍消费 command:* IPC，
// 数据源已切换为 entries，映射回旧字段即可零改动复用渲染层）
function commandsFromEntries(entries) {
  return toArray(entries)
    .filter((e) => e && e.type === 'command')
    .map((e) => ({ id: e.id, title: e.title, content: e.content, pinned: e.pinned === true }));
}

// 旧命令表单 → 新 entry（command:add 用；保留 spaceId/coverId 等三期字段的更新见 applyCommandToEntry）
function entryFromCommand(c, now) {
  now = now || Date.now();
  return {
    id: String((c && c.id) || `entry-${now}`),
    spaceId: DEFAULT_SPACE_ID,
    type: 'command',
    title: String((c && c.title) || ''),
    content: String((c && c.content) || ''),
    coverId: null,
    pinned: (c && c.pinned) === true,
    createdAt: now,
    updatedAt: now
  };
}

// command:update 用：只改旧命令字段，保留 entry 上的空间/封面/时间戳等三期字段
function applyCommandToEntry(entry, c) {
  return {
    ...entry,
    title: String((c && c.title) || ''),
    content: String((c && c.content) || ''),
    pinned: (c && c.pinned) === true,
    updatedAt: Date.now()
  };
}

// 校验迁移结果：全部通过才允许落盘（返回问题清单，空数组 = 通过）
function validateData(d) {
  const problems = [];
  if (!Array.isArray(d.spaces) || d.spaces.length === 0) {
    problems.push('spaces 必须是非空数组');
  } else {
    const ids = new Set();
    d.spaces.forEach((s, i) => {
      if (!s || typeof s.id !== 'string' || !s.id) problems.push(`spaces[${i}].id 无效`);
      else if (ids.has(s.id)) problems.push(`spaces id 重复：${s.id}`);
      else ids.add(s.id);
      if (!s || typeof s.name !== 'string' || !s.name.trim()) problems.push(`spaces[${i}].name 无效`);
    });
    const spaceIds = new Set(d.spaces.filter(Boolean).map((s) => s.id));
    d.entries.forEach((e, i) => {
      if (!e || typeof e.id !== 'string' || !e.id) problems.push(`entries[${i}].id 无效`);
      if (!e || !spaceIds.has(e.spaceId)) problems.push(`entries[${i}].spaceId 不存在：${e && e.spaceId}`);
      if (!e || (e.type !== 'prompt' && e.type !== 'command')) problems.push(`entries[${i}].type 无效`);
      if (!e || typeof e.title !== 'string') problems.push(`entries[${i}].title 无效`);
      if (!e || typeof e.content !== 'string') problems.push(`entries[${i}].content 无效`);
    });
  }
  if (!Array.isArray(d.entries)) problems.push('entries 必须是数组');
  if (!Array.isArray(d.noteSpaces) || d.noteSpaces.length === 0) {
    problems.push('noteSpaces 必须是非空数组');
  } else {
    const noteSpaceIds = new Set(d.noteSpaces.filter(Boolean).map((s) => s.id));
    toArray(d.notes).forEach((note, i) => {
      if (!note || !noteSpaceIds.has(note.spaceId)) problems.push(`notes[${i}].spaceId 不存在：${note && note.spaceId}`);
    });
  }
  if (!Array.isArray(d.notes)) problems.push('notes 必须是数组');
  if (!Array.isArray(d.tasks)) problems.push('tasks 必须是数组');
  if (!Array.isArray(d.reminders)) problems.push('reminders 必须是数组');
  if (!d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) {
    problems.push('settings 必须是对象');
  } else if (d.settings.defaultPage !== 'prompts' && d.settings.defaultPage !== 'notes') {
    problems.push(`settings.defaultPage 无效：${d.settings.defaultPage}`);
  }
  return problems;
}

// 已是 v3（或迁移完成）时补齐缺失的默认字段：只填缺失键，不覆盖已有值；
// settings 为非对象（损坏）时不写回，交由读取方兜底，避免覆盖损坏源数据
function ensureDefaults(store) {
  try {
    if (!Array.isArray(store.get('spaces'))) store.set('spaces', [defaultSpace(Date.now())]);
    if (!Array.isArray(store.get('noteSpaces'))) store.set('noteSpaces', [defaultNoteSpace(Date.now())]);
    if (!Array.isArray(store.get('entries'))) store.set('entries', []);
    if (!Array.isArray(store.get('notes'))) store.set('notes', []);
    if (!Array.isArray(store.get('tasks'))) store.set('tasks', []);
    if (!Array.isArray(store.get('reminders'))) store.set('reminders', []);
    const s = store.get('settings');
    if (s === undefined || s === null) {
      store.set('settings', mergeSettings({}));
    } else if (s && typeof s === 'object' && !Array.isArray(s)) {
      store.set('settings', mergeSettings(s));
    }
  } catch (e) {
    // 补默认失败不致命：保持原样，由各读取方 try/catch 兜底
  }
}

// 一次性迁移（产品方案 §9）：
// 1) schemaVersion >= 3 → 只补默认字段，直接返回（幂等）
// 2) 备份旧 commands/reminders/settings 到 backupSchemaV2（即使后续失败也保留，供人工恢复）
// 3) 转换：旧命令 → entries（归入默认空间）；reminders 原样；settings 合并默认值
// 4) 校验通过才落盘；schemaVersion 最后写入（作为迁移完成标记）
// 5) 任一步失败：回滚已写入的数据键到迁移前原值（原本不存在的键删除），
//    不写 schemaVersion、不删除旧 commands 字段
function migrate(store) {
  let current = 0;
  try {
    current = Number(store.get('schemaVersion')) || 0;
  } catch (e) {
    current = 0;
  }
  if (current >= SCHEMA_VERSION) {
    ensureDefaults(store);
    return { ok: true, migrated: false, alreadyCurrent: true };
  }

  const DATA_KEYS = ['spaces', 'noteSpaces', 'entries', 'notes', 'tasks', 'reminders', 'settings'];
  // 迁移前快照（回滚依据）：electron-store 的 has 为磁盘真实存在性，get 带默认值兜底
  let snapshot = null;
  try {
    const commands = toArray(store.get('commands'));
    const reminders = toArray(store.get('reminders'));
    const oldSettings = plainObject(store.get('settings'));
    const now = Date.now();
    snapshot = DATA_KEYS.map((k) => ({
      k,
      existed: store.has ? store.has(k) : store.get(k) !== undefined,
      value: store.get(k)
    }));

    // schema v3 已有共享 spaces：提示词空间原样保留；记事本仅迁移确有笔记引用的空间。
    // 这样可修正“在提示词中新建空空间后记事本也出现”的历史错误，同时不丢已有笔记归属。
    if (current === 3) {
      const oldSpaces = toArray(store.get('spaces'));
      const oldEntries = toArray(store.get('entries'));
      const oldNotes = toArray(store.get('notes'));
      const usedNoteSpaceIds = new Set(oldNotes.map((note) => note && note.spaceId).filter(Boolean));
      const noteSpaceIdMap = new Map();
      const migratedNoteSpaces = [defaultNoteSpace(now)];
      oldSpaces.forEach((space) => {
        if (!space || !usedNoteSpaceIds.has(space.id)) return;
        const id = space.id === DEFAULT_SPACE_ID ? DEFAULT_NOTE_SPACE_ID : `note-${space.id}`;
        noteSpaceIdMap.set(space.id, id);
        if (id !== DEFAULT_NOTE_SPACE_ID) {
          migratedNoteSpaces.push({ ...space, id, order: migratedNoteSpaces.length });
        }
      });
      const migratedNotes = oldNotes.map((note) => ({
        ...note,
        spaceId: noteSpaceIdMap.get(note.spaceId) || DEFAULT_NOTE_SPACE_ID
      }));
      const data = {
        spaces: oldSpaces.length ? oldSpaces : [defaultSpace(now)],
        noteSpaces: migratedNoteSpaces,
        entries: oldEntries,
        notes: migratedNotes,
        tasks: toArray(store.get('tasks')),
        reminders,
        settings: mergeSettings(oldSettings)
      };
      const problems = validateData(data);
      if (problems.length) throw new Error(`数据校验失败：${problems.join('；')}`);
      DATA_KEYS.forEach((k) => store.set(k, data[k]));
      store.set('schemaVersion', SCHEMA_VERSION);
      return { ok: true, migrated: true, fromVersion: 3, noteSpaceCount: data.noteSpaces.length };
    }

    // ① 备份（带时间戳；即使迁移失败也保留）
    store.set('backupSchemaV2', {
      savedAt: now, schemaVersion: current,
      commands, reminders, settings: oldSettings
    });

    // ② 转换
    const data = {
      spaces: [defaultSpace(now)],
      noteSpaces: [defaultNoteSpace(now)],
      entries: entriesFromCommands(commands, now),
      notes: [],
      tasks: [],
      reminders,
      settings: mergeSettings(oldSettings)
    };

    // ④ 校验（不通过即抛错 → 走回滚分支，不落盘）
    const problems = validateData(data);
    if (problems.length) throw new Error(`数据校验失败：${problems.join('；')}`);

    // ⑤ 落盘：先写数据，最后写版本号；旧 commands 字段原样保留（一个版本周期内兼容读取）
    DATA_KEYS.forEach((k) => store.set(k, data[k]));
    store.set('schemaVersion', SCHEMA_VERSION);
    return { ok: true, migrated: true, entryCount: data.entries.length };
  } catch (err) {
    if (snapshot) {
      for (const s of snapshot) {
        try {
          if (s.existed) store.set(s.k, s.value);
          else if (store.delete) store.delete(s.k);
        } catch (e) { /* 回滚尽力而为 */ }
      }
    }
    return { ok: false, migrated: false, error: (err && err.message) ? err.message : String(err) };
  }
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SPACE_ID,
  DEFAULT_SPACE_NAME,
  DEFAULT_NOTE_SPACE_ID,
  DEFAULT_NOTE_SPACE_NAME,
  SETTINGS_DEFAULTS,
  mergeSettings,
  normalizeSettingsPatch,
  toPublicChatSettings,
  entriesFromCommands,
  commandsFromEntries,
  entryFromCommand,
  applyCommandToEntry,
  validateData,
  ensureDefaults,
  migrate
};
