(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const PROTOTYPE_TODAY = '2026-08-25';

  const initialData = Object.freeze({
    spaces: [
      { id: 'commands', name: '常用命令', glyph: '⌘', tone: 'mint' },
      { id: 'poster', name: '海报制作', glyph: '▧', tone: 'gold' },
      { id: 'art', name: 'AI 绘图', glyph: '◈', tone: 'pink' },
      { id: 'writing', name: '文稿写作', glyph: '✎', tone: 'cyan' }
    ],
    entries: [
      { id: 'entry-poster', spaceId: 'poster', type: 'prompt', title: '产品海报视觉提示词', content: '为一款轻盈、未来感的桌面应用制作竖版海报。使用深蓝夜幕、青色晶体光、少量金色点缀，并保留清晰的信息层级。', cover: 'poster', pinned: true, updated: 8 },
      { id: 'entry-character', spaceId: 'art', type: 'prompt', title: '角色立绘 · 流萤少女', content: 'anime character concept, pearl white hair, cyan crystal accessories, soft rim light, elegant silhouette, transparent background', cover: 'character', pinned: false, updated: 7 },
      { id: 'entry-git', spaceId: 'commands', type: 'command', title: 'Git 提交并推送', content: 'git add .\ngit commit -m "update"\ngit push', cover: 'none', pinned: true, updated: 6 },
      { id: 'entry-start', spaceId: 'commands', type: 'command', title: '启动本地项目', content: 'npm install\nnpm run dev', cover: 'none', pinned: false, updated: 5 },
      { id: 'entry-weekly', spaceId: 'writing', type: 'prompt', title: '周报提炼助手', content: '请将以下工作记录整理为结构清晰的周报，按“本周完成、关键结果、风险与下周计划”输出，语气简洁专业。', cover: 'none', pinned: false, updated: 4 },
      { id: 'entry-check', spaceId: 'commands', type: 'command', title: '检查 JavaScript 语法', content: 'node --check renderer.js', cover: 'none', pinned: false, updated: 3 },
      { id: 'entry-negative', spaceId: 'art', type: 'prompt', title: '通用负面提示词', content: 'low quality, blurry, extra fingers, malformed hands, watermark, text artifacts, oversaturated colors', cover: 'none', pinned: false, updated: 2 },
      { id: 'entry-outline', spaceId: 'writing', type: 'prompt', title: '课程大纲生成器', content: '根据学习目标与受众基础，生成包含导入、演示、练习和总结的 90 分钟课程大纲。', cover: 'none', pinned: false, updated: 1 }
    ],
    notes: [
      { id: 'note-build', spaceId: 'commands', title: '打包流程备忘', content: '先跑 npm run dist:clean，产物输出到 TEMP 目录，再复制回 dist\。注意 .env 不能进入安装包，打包前先检查 files 白名单。', updated: 6 },
      { id: 'note-idea', spaceId: 'writing', title: '课程互动点子', content: '让学生现场改一行 CSS，观察卡片样式变化；再用 QA 脚本演示自动化验收，直观感受“小步验证”的价值。', updated: 5 },
      { id: 'note-color', spaceId: 'art', title: '配色灵感', content: '深夜蓝 #0b1830 搭配萤光青 #54d7d7，金色点缀不超过 10%。对比度不足时优先调背景明度而不是换主色。', updated: 4 },
      { id: 'note-poster', spaceId: 'poster', title: '海报文案草稿', content: '主标题：「让灵感在桌面上发光」。副标题备选：「随手记下每一个火花」。视觉沿用流萤主题，右下角留版本号位置。', updated: 3 }
    ],
    tasks: [
      { id: 'task-review', kind: 'range', title: '确认三期界面方案', startDate: '2026-08-20', endDate: '2026-09-05', time: '', priority: 'high', notes: '整理评审意见并冻结主要交互。', reminderId: 'reminder-review', completed: false },
      { id: 'task-course', kind: 'range', title: '准备课程演示素材', startDate: '2026-08-25', endDate: '2026-08-30', time: '', priority: 'normal', notes: '补充提示词管理的示例数据。', reminderId: null, completed: false },
      { id: 'task-ideas', kind: 'range', title: '整理本周灵感', startDate: '2026-08-20', endDate: '2026-09-05', time: '', priority: 'low', notes: '把散落提示词归档到对应空间。', reminderId: null, completed: false },
      { id: 'task-record', kind: 'range', title: '录制课程操作演示', startDate: '2026-08-26', endDate: '2026-08-28', time: '', priority: 'high', notes: '录制高保真原型关键流程。', reminderId: null, completed: false },
      { id: 'task-sync', kind: 'today', title: '临时同步视觉细节', date: '2026-08-25', time: '15:30', priority: 'normal', notes: '确认字号与日期区间展示。', reminderId: null, completed: false }
    ],
    reminders: [
      { id: 'reminder-break', title: '休息眼睛，看看远处', type: 'interval', value: '50', enabled: true, linkedTaskId: null },
      { id: 'reminder-usage', title: '已使用电脑 1 小时，起来活动', type: 'usage', value: '60', enabled: true, linkedTaskId: null },
      { id: 'reminder-review', title: '三期方案评审', type: 'absolute', value: '10:30', date: '2026-08-25', enabled: true, linkedTaskId: 'task-review' },
      { id: 'reminder-meeting', title: '课程小组同步会议', type: 'absolute', value: '16:30', date: '2026-08-27', enabled: false, linkedTaskId: null }
    ]
  });

  const cloneInitial = () => JSON.parse(JSON.stringify(initialData));
  const state = {
    ...cloneInitial(),
    page: 'prompts', currentSpace: 'all', filter: 'all', search: '', sort: 'pinned',
    currentNoteSpace: 'all', noteSearch: '', noteSort: 'updated', editingNoteId: null,
    defaultPage: 'prompts',
    selectedDate: '2026-08-25', calendarYear: 2026, calendarMonth: 7,
    editingEntryId: null, editingTaskId: null, editingReminderId: null,
    selectedDay: 25, customCover: null, coverFallback: 'character',
    rangePickerYear: 2026, rangePickerMonth: 7, selectingRangeEnd: false
  };

  let noteSaveTimer;

  let toastTimer;
  const toast = (message, icon = '✓') => {
    clearTimeout(toastTimer);
    $('#toast span').textContent = icon;
    $('#toast-message').textContent = message;
    $('#toast').classList.add('show');
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2100);
  };

  const setSavedState = (message = '所有更改已保存') => {
    const node = $('#save-state');
    node.classList.add('saving');
    node.innerHTML = `<i></i>${esc(message)}`;
    setTimeout(() => {
      node.classList.remove('saving');
    }, 120);
  };

  const formatDate = (dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return `${year} 年 ${month} 月 ${day} 日`;
  };

  const shortDate = (dateString) => dateString ? dateString.replaceAll('-', '/') : '请选择';
  const isDateInRange = (date, startDate, endDate) => Boolean(date && startDate && endDate && date >= startDate && date <= endDate);
  const finalWeekStart = (endDate) => {
    const date = new Date(`${endDate}T12:00:00`);
    date.setDate(date.getDate() - 6);
    return date.toISOString().slice(0, 10);
  };
  const shouldMapRangeTask = (task, date) => task.kind === 'range'
    && isDateInRange(date, task.startDate, task.endDate)
    && (task.priority === 'high' || date >= finalWeekStart(task.endDate));

  function showPage(page) {
    state.page = page;
    $$('.page').forEach((node) => node.classList.toggle('active', node.id === `page-${page}`));
    $$('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.page === page));
    if (page === 'notes') renderNotes();
    if (page === 'schedule') renderSchedule();
  }

  function renderSpaces() {
    const allCount = state.entries.length;
    $('#space-list').innerHTML = `
      <button type="button" class="space-item system ${state.currentSpace === 'all' ? 'active' : ''}" data-space="all">
        <span class="space-glyph night">✦</span><span>全部内容</span><b>${allCount}</b>
      </button>
      ${state.spaces.map((space) => {
        const count = state.entries.filter((entry) => entry.spaceId === space.id).length;
        return `<button type="button" class="space-item ${state.currentSpace === space.id ? 'active' : ''}" data-space="${esc(space.id)}">
          <span class="space-glyph ${esc(space.tone)}">${esc(space.glyph)}</span><span>${esc(space.name)}</span><b>${count}</b>
        </button>`;
      }).join('')}`;

    $('#entry-space').innerHTML = state.spaces.map((space) => `<option value="${esc(space.id)}">${esc(space.name)}</option>`).join('');
    renderSpaceManager();
  }

  function renderSpaceManager() {
    $('#space-manager-list').innerHTML = state.spaces.map((space, index) => {
      const count = state.entries.filter((entry) => entry.spaceId === space.id).length;
      const lastSpace = state.spaces.length === 1;
      return `<div class="manager-row"><span class="space-glyph ${esc(space.tone)}">${esc(space.glyph)}</span><div><strong>${esc(space.name)}</strong><small>${count} 条内容</small></div><div class="row-actions"><button type="button" data-space-move="${space.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-space-edit="${space.id}">编辑</button><button type="button" class="danger-text" data-space-delete="${space.id}" ${lastSpace ? 'disabled title="至少保留一个项目空间"' : ''}>删除</button></div></div>`;
    }).join('');
  }

  function getVisibleEntries() {
    const keyword = state.search.trim().toLocaleLowerCase('zh-CN');
    return state.entries
      .filter((entry) => state.currentSpace === 'all' || entry.spaceId === state.currentSpace)
      .filter((entry) => state.filter === 'all' || entry.type === state.filter)
      .filter((entry) => !keyword || `${entry.title} ${entry.content}`.toLocaleLowerCase('zh-CN').includes(keyword))
      .sort((a, b) => {
        if (state.sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
        if (state.sort === 'updated') return b.updated - a.updated;
        return Number(b.pinned) - Number(a.pinned) || b.updated - a.updated;
      });
  }

  function entryCover(entry) {
    if (entry.cover === 'none') return '';
    const copyButton = `<button type="button" class="cover-copy-button" data-entry-image-copy="${entry.id}">复制图片</button>`;
    if (entry.cover?.startsWith('data:')) return `<div class="cover custom-cover" style="background-image:url('${entry.cover}')">${copyButton}<span class="cover-chip">本地图片</span></div>`;
    if (entry.cover === 'character') return `<div class="cover cover-character">${copyButton}<img src="../assets/chat-avatar.png" alt="角色例图"><span class="cover-chip">角色例图</span></div>`;
    return `<div class="cover cover-poster">${copyButton}<div class="cover-copy"><small>NEON POSTER</small><strong>夏夜萤光</strong><span>Visual Study 03</span></div><span class="cover-chip">萤光海报</span></div>`;
  }

  function renderEntries() {
    const visible = getVisibleEntries();
    const space = state.spaces.find((item) => item.id === state.currentSpace);
    const name = space?.name || '全部内容';
    $('#current-space').textContent = name;
    $('#workspace-title').textContent = name;
    $('#workspace-description').textContent = space ? `管理“${space.name}”空间内的提示词与常用命令。` : '集中整理命令和提示词，快速查找、编辑与复制。';
    $('#result-count').textContent = String(visible.length);
    $('#entry-empty').hidden = visible.length > 0;
    $('#prompt-grid').hidden = visible.length === 0;
    $('#prompt-grid').innerHTML = visible.map((entry) => {
      const spaceName = state.spaces.find((item) => item.id === entry.spaceId)?.name || '未分类';
      const compact = entry.cover === 'none';
      return `<article class="prompt-card ${compact ? 'compact' : 'featured'}" data-entry-id="${entry.id}" tabindex="0">
        ${entryCover(entry)}
        <div class="card-body">
          <div class="card-meta"><span class="type ${entry.type}">${entry.type === 'prompt' ? '提示词' : '命令'}</span><span>${esc(spaceName)}</span>${entry.pinned ? '<span class="pin-text">◆ 置顶</span>' : ''}</div>
          <h3>${esc(entry.title)}</h3>
          ${entry.type === 'command' ? `<pre class="card-copy">${esc(entry.content)}</pre>` : `<p class="card-copy">${esc(entry.content)}</p>`}
          <div class="card-footer"><span>${entry.updated >= 7 ? '今天更新' : `${entry.updated + 1} 天前更新`}</span><button type="button" class="copy-button" data-entry-copy="${entry.id}">复制</button></div>
        </div>
      </article>`;
    }).join('');
    renderSpaces();
  }

  function clearFieldErrors(root) {
    $$('.field-error', root).forEach((node) => { node.textContent = ''; });
    $$('input.error, textarea.error', root).forEach((node) => node.classList.remove('error'));
  }

  function setFieldError(id, message) {
    const input = $(`#${id}`);
    input.classList.add('error');
    $(`[data-error-for="${id}"]`).textContent = message;
    input.focus();
  }

  function updateCoverPreview() {
    const value = $('#entry-cover').value;
    const preview = $('#entry-cover-preview');
    preview.className = 'drawer-cover';
    preview.style.backgroundImage = '';
    const imageMode = value === 'image';
    $('#cover-preview-kicker').textContent = imageMode ? 'IMAGE CARD' : 'COMPACT CARD';
    $('#cover-preview-title').textContent = imageMode ? '包含图片的卡片' : '无图片的紧凑卡片';
    $('#cover-preview-hint').textContent = imageMode ? '图片可在卡片上快速复制' : '选择本地图片后自动切换为带图卡片';
    if (!imageMode) preview.classList.add('no-cover-preview');
    if (imageMode && state.customCover) {
      preview.classList.add('custom-preview');
      preview.style.backgroundImage = `linear-gradient(rgba(8,19,38,.08),rgba(8,19,38,.28)), url('${state.customCover}')`;
    } else if (imageMode && state.coverFallback === 'poster') {
      preview.classList.add('poster-preview');
    } else if (imageMode) {
      preview.classList.add('character-preview');
    }
  }

  function openEntryDrawer(entryId = null) {
    state.editingEntryId = entryId;
    clearFieldErrors($('#entry-form'));
    const entry = state.entries.find((item) => item.id === entryId);
    $('#entry-mode-label').textContent = entry ? '编辑内容' : '新建内容';
    $('#entry-drawer-type').textContent = entry?.type === 'command' ? '常用命令' : '提示词';
    $('#entry-id').value = entry?.id || '';
    $('#entry-type').value = entry?.type || 'prompt';
    $('#entry-space').value = entry?.spaceId || (state.currentSpace === 'all' ? state.spaces[0].id : state.currentSpace);
    $('#entry-title').value = entry?.title || '';
    $('#entry-content').value = entry?.content || '';
    $('#entry-cover').value = entry?.cover && entry.cover !== 'none' ? 'image' : 'none';
    state.customCover = entry?.cover?.startsWith('data:') ? entry.cover : null;
    state.coverFallback = entry?.cover && entry.cover !== 'none' && !entry.cover.startsWith('data:') ? entry.cover : 'character';
    $('#entry-pinned').checked = Boolean(entry?.pinned);
    $('#entry-delete').hidden = !entry;
    $('#entry-char-count').textContent = `${$('#entry-content').value.length} / 2000`;
    updateCoverPreview();
    $('#drawer-backdrop').classList.add('open');
    $('#entry-drawer').classList.add('open');
    $('#entry-drawer').setAttribute('aria-hidden', 'false');
    setTimeout(() => $('#entry-title').focus(), 160);
  }

  function closeEntryDrawer() {
    $('#drawer-backdrop').classList.remove('open');
    $('#entry-drawer').classList.remove('open');
    $('#entry-drawer').setAttribute('aria-hidden', 'true');
    state.editingEntryId = null;
  }

  function saveEntry(event) {
    event.preventDefault();
    clearFieldErrors($('#entry-form'));
    const title = $('#entry-title').value.trim();
    const content = $('#entry-content').value.trim();
    if (!title) return setFieldError('entry-title', '请输入标题');
    if (!content) return setFieldError('entry-content', '请输入正文');
    const coverChoice = $('#entry-cover').value;
    const data = {
      type: $('#entry-type').value,
      spaceId: $('#entry-space').value,
      title, content,
      cover: coverChoice === 'image' ? (state.customCover || state.coverFallback || 'character') : 'none',
      pinned: $('#entry-pinned').checked,
      updated: 99
    };
    if (state.editingEntryId) {
      Object.assign(state.entries.find((item) => item.id === state.editingEntryId), data);
      toast('内容更改已应用（刷新后重置）');
    } else {
      state.entries.unshift({ id: uid('entry'), ...data });
      toast('已新建内容（刷新后重置）');
    }
    closeEntryDrawer();
    renderEntries();
  }

  function copyText(text, label = '内容') {
    navigator.clipboard?.writeText(text).catch(() => {});
    toast(`${label}已复制`);
  }

  function entryImageSource(entry) {
    if (entry.cover?.startsWith('data:')) return entry.cover;
    if (entry.cover === 'character') return new URL('../assets/chat-avatar.png', location.href).href;
    return new URL('../assets/ui-theme/firefly/backgrounds/chat-night.png', location.href).href;
  }

  async function copyEntryImage(entry) {
    try {
      const response = await fetch(entryImageSource(entry));
      const sourceBlob = await response.blob();
      const bitmap = await createImageBitmap(sourceBlob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('image clipboard unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      toast('图片已复制');
    } catch {
      toast('当前环境暂不支持复制图片', '!');
    }
  }

  function openSpaceDialog(mode = 'create', spaceId = null) {
    const dialog = $('#space-dialog');
    dialog.dataset.mode = mode;
    dialog.dataset.spaceId = spaceId || '';
    clearFieldErrors(dialog);
    $('#space-manager').hidden = mode !== 'manage';
    $('#space-name').value = mode === 'edit' ? state.spaces.find((item) => item.id === spaceId)?.name || '' : '';
    $('#space-dialog-title').textContent = mode === 'edit' ? '重命名项目空间' : mode === 'manage' ? '管理项目空间' : '新建项目空间';
    $('#space-save').textContent = mode === 'edit' ? '保存名称' : '保存空间';
    $('#space-save').hidden = mode === 'manage';
    renderSpaceManager();
    dialog.showModal();
    if (mode !== 'manage') setTimeout(() => $('#space-name').focus(), 50);
  }

  function saveSpace(event) {
    if (event.submitter?.value === 'cancel') return; // 「确认」按钮与右上角 ×：直接关闭弹窗，不做校验
    event.preventDefault();
    const dialog = $('#space-dialog');
    const name = $('#space-name').value.trim();
    clearFieldErrors(dialog);
    if (!name) return setFieldError('space-name', '请输入空间名称');
    const editingId = dialog.dataset.spaceId;
    if (state.spaces.some((space) => space.name === name && space.id !== editingId)) return setFieldError('space-name', '空间名称不能重复');
    if (dialog.dataset.mode === 'edit') {
      state.spaces.find((space) => space.id === editingId).name = name;
      toast('空间名称已更新');
    } else {
      state.spaces.push({ id: uid('space'), name, glyph: '◇', tone: ['cyan', 'mint', 'gold', 'pink'][state.spaces.length % 4] });
      toast('项目空间已创建');
    }
    dialog.close();
    renderEntries();
    renderNotes();
  }

  function showConfirm({ title, subtitle = '此操作需要确认', message, confirmText = '确认', danger = true, extra = '' }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-subtitle').textContent = subtitle;
    $('#confirm-message').textContent = message;
    $('#confirm-extra').innerHTML = extra;
    $('#confirm-actions').innerHTML = `<button value="confirm" class="${danger ? 'danger-button' : 'primary-button'}" id="confirm-primary">${esc(confirmText)}</button>`;
    return new Promise((resolve) => {
      const done = () => { dialog.removeEventListener('close', done); resolve(dialog.returnValue === 'confirm'); };
      dialog.addEventListener('close', done);
      dialog.showModal();
    });
  }

  async function deleteSpace(spaceId) {
    const space = state.spaces.find((item) => item.id === spaceId);
    if (state.spaces.length === 1) {
      toast('至少保留一个项目空间', '!');
      return;
    }
    const entries = state.entries.filter((entry) => entry.spaceId === spaceId);
    const notes = state.notes.filter((note) => note.spaceId === spaceId);
    let extra = '';
    if (entries.length + notes.length) {
      const choices = state.spaces.filter((item) => item.id !== spaceId);
      extra = `<div class="field-grid two"><label><span>内容处理方式</span><select id="space-delete-strategy"><option value="migrate">迁移全部内容（推荐）</option><option value="delete">一并删除内容</option></select></label><label><span>迁移目标</span><select id="space-migrate-target">${choices.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label></div>`;
    }
    const ok = await showConfirm({ title: `删除“${space.name}”`, message: entries.length + notes.length ? '请选择空间内现有内容的处理方式，然后删除当前空间。' : '这是一个空空间，可以安全删除。', confirmText: '确认删除空间', extra });
    if (!ok) return;
    const strategy = $('#space-delete-strategy')?.value || 'migrate';
    const target = $('#space-migrate-target')?.value;
    if (strategy === 'migrate' && target) {
      entries.forEach((entry) => { entry.spaceId = target; });
      notes.forEach((note) => { note.spaceId = target; });
    }
    if (strategy === 'delete') {
      state.entries = state.entries.filter((entry) => entry.spaceId !== spaceId);
      state.notes = state.notes.filter((note) => note.spaceId !== spaceId);
    }
    state.spaces = state.spaces.filter((item) => item.id !== spaceId);
    if (state.currentSpace === spaceId) state.currentSpace = 'all';
    if (state.currentNoteSpace === spaceId) state.currentNoteSpace = 'all';
    $('#space-dialog').close();
    renderEntries();
    renderNotes();
    toast(strategy === 'delete' ? '空间及其中内容已删除' : '空间已删除，内容已安全迁移');
  }

  function renderNoteSpaces() {
    const allCount = state.notes.length;
    $('#note-space-list').innerHTML = `
      <button type="button" class="space-item system ${state.currentNoteSpace === 'all' ? 'active' : ''}" data-note-space="all">
        <span class="space-glyph night">✦</span><span>全部笔记</span><b>${allCount}</b>
      </button>
      ${state.spaces.map((space) => {
        const count = state.notes.filter((note) => note.spaceId === space.id).length;
        return `<button type="button" class="space-item ${state.currentNoteSpace === space.id ? 'active' : ''}" data-note-space="${esc(space.id)}">
          <span class="space-glyph ${esc(space.tone)}">${esc(space.glyph)}</span><span>${esc(space.name)}</span><b>${count}</b>
        </button>`;
      }).join('')}`;
  }

  function getVisibleNotes() {
    const keyword = state.noteSearch.trim().toLocaleLowerCase('zh-CN');
    return state.notes
      .filter((note) => state.currentNoteSpace === 'all' || note.spaceId === state.currentNoteSpace)
      .filter((note) => !keyword || `${note.title} ${note.content}`.toLocaleLowerCase('zh-CN').includes(keyword))
      .sort((a, b) => (state.noteSort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : b.updated - a.updated));
  }

  function renderNotes() {
    const visible = getVisibleNotes();
    const space = state.spaces.find((item) => item.id === state.currentNoteSpace);
    const name = space?.name || '全部笔记';
    $('#current-note-space').textContent = name;
    $('#note-workspace-title').textContent = name;
    $('#note-workspace-description').textContent = space ? `管理“${space.name}”空间内的记事本。` : '无需配置，一键新建；打开即写，内容自动保存。';
    $('#note-count').textContent = String(visible.length);
    $('#note-empty').hidden = visible.length > 0;
    $('#note-grid').hidden = visible.length === 0;
    $('#note-grid').innerHTML = visible.map((note) => {
      const spaceName = state.spaces.find((item) => item.id === note.spaceId)?.name || '未分类';
      return `<article class="note-card" data-note-id="${note.id}" tabindex="0">
        <div class="note-card-top"><span class="note-glyph">✎</span><span class="note-space-tag">${esc(spaceName)}</span></div>
        <h3>${esc(note.title || '无标题笔记')}</h3>
        <p class="note-excerpt">${esc(note.content || '空白笔记，点击打开开始记录')}</p>
        <footer><span>${note.updated >= 7 ? '刚刚更新' : `${note.updated + 1} 天前更新`}</span><span class="note-open-hint">打开编辑</span></footer>
      </article>`;
    }).join('');
    renderNoteSpaces();
  }

  function setNoteSaveState(message, saving = false) {
    const node = $('#note-save-state');
    node.classList.toggle('saving', saving);
    node.innerHTML = `<i></i>${esc(message)}`;
  }

  function openNoteEditor(noteId = null) {
    state.editingNoteId = noteId;
    const note = noteId ? state.notes.find((item) => item.id === noteId) : null;
    $('#note-editor-space').textContent = state.spaces.find((item) => item.id === note?.spaceId)?.name || '未分类';
    $('#note-title').value = note?.title || '';
    $('#note-content').value = note?.content || '';
    setNoteSaveState('内容自动保存');
    $('#note-browser').hidden = true;
    $('#note-editor').hidden = false;
    $('#note-content').focus();
  }

  function closeNoteEditor() {
    $('#note-editor').hidden = true;
    $('#note-browser').hidden = false;
    state.editingNoteId = null;
    renderNotes();
  }

  function noteDraftChanged() {
    const note = state.notes.find((item) => item.id === state.editingNoteId);
    if (note) {
      note.title = $('#note-title').value.trim();
      note.content = $('#note-content').value;
      note.updated = 99;
    }
    clearTimeout(noteSaveTimer);
    setNoteSaveState('保存中…', true);
    noteSaveTimer = setTimeout(() => setNoteSaveState('内容自动保存'), 500);
  }

  function createNote() {
    const spaceId = state.currentNoteSpace === 'all' ? state.spaces[0]?.id || null : state.currentNoteSpace;
    const note = { id: uid('note'), spaceId, title: '', content: '', updated: 99 };
    state.notes.unshift(note);
    renderNotes();
    openNoteEditor(note.id);
    toast('已新建记事本，直接开始记录');
  }

  async function deleteNote() {
    const note = state.notes.find((item) => item.id === state.editingNoteId);
    if (!note) return;
    const ok = await showConfirm({ title: `删除“${note.title || '无标题笔记'}”`, message: '记事本删除后不可恢复，刷新页面可重置示例数据。', confirmText: '删除记事本' });
    if (!ok) return;
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.editingNoteId = null;
    $('#note-editor').hidden = true;
    $('#note-browser').hidden = false;
    renderNotes();
    toast('记事本已删除');
  }

  function priorityLabel(priority) {
    return ({ high: '高优先级', normal: '普通', low: '低优先级' })[priority];
  }

  function taskCard(task, context) {
    const mappedRange = context === 'today' && task.kind === 'range';
    const mappedReason = task.priority === 'high' ? '高优先级 · 区间内同步' : '已进入任务最后一周';
    const origin = context === 'today'
      ? `<span class="task-origin ${task.kind}">${mappedRange ? '来自长期待办' : '当日新增'}</span>`
      : '<span class="task-origin range">长期事务</span>';
    const dateText = task.kind === 'range'
      ? `${shortDate(task.startDate)} — ${shortDate(task.endDate)}`
      : `${shortDate(task.date)} · 当日`;
    return `<article class="task-card priority-${task.priority} source-${task.kind}" data-task-id="${task.id}" tabindex="0">
      <div class="task-top"><div>${origin}<span>${priorityLabel(task.priority)}</span></div><div><button type="button" class="complete-task" data-task-complete="${task.id}" title="标记完成">✓ 完成</button><button type="button" class="task-more" aria-label="编辑任务">•••</button></div></div>
      <h3>${esc(task.title)}</h3><p>${esc(task.notes || '暂无备注')}</p>
      ${mappedRange ? `<div class="range-progress"><i></i><span>${mappedReason}</span></div>` : ''}
      <footer>${task.kind === 'today' ? `<span>${task.time ? `◷ ${task.time}` : '全天'}</span>` : ''}<span class="task-date-meta">${dateText}</span>${task.reminderId ? '<span>◉ 已提醒</span>' : ''}</footer>
    </article>`;
  }

  function renderTasks() {
    const keyword = $('#task-search')?.value.trim().toLocaleLowerCase('zh-CN') || '';
    const matches = (task) => !keyword || `${task.title} ${task.notes}`.toLocaleLowerCase('zh-CN').includes(keyword);
    const active = state.tasks.filter((task) => !task.completed && matches(task));
    const rangeTasks = active.filter((task) => task.kind === 'range');
    const todayTasks = active.filter((task) => task.kind === 'today' ? task.date === state.selectedDate : shouldMapRangeTask(task, state.selectedDate));
    $('#task-search').placeholder = '搜索长期待办与今日事项';
    $('[data-task-count="range"]').textContent = String(rangeTasks.length);
    $('[data-task-count="today"]').textContent = String(todayTasks.length);
    $('[data-task-list="range"]').innerHTML = rangeTasks.length ? rangeTasks.map((task) => taskCard(task, 'range')).join('') : '<div class="column-empty"><span>＋</span><p>暂时没有长期待办</p></div>';
    $('[data-task-list="today"]').innerHTML = todayTasks.length ? todayTasks.map((task) => taskCard(task, 'today')).join('') : '<div class="column-empty"><span>☾</span><p>这一天没有安排</p></div>';
    $('#schedule-summary').textContent = `${formatDate(state.selectedDate)} · 今日显示 ${todayTasks.length} 项，其中 ${todayTasks.filter((task) => task.kind === 'range').length} 项来自长期待办`;
    const [, month, day] = state.selectedDate.split('-').map(Number);
    $('[data-date-today]').textContent = `${state.selectedDate === PROTOTYPE_TODAY ? '今天 · ' : ''}${month}月${day}日`;
  }

  function updateTaskKind(kind) {
    $('#task-kind').value = kind;
    $('#task-range-field').hidden = kind !== 'range';
    $('#task-date-field').hidden = kind !== 'today';
    $('#task-time-field').hidden = kind !== 'today';
    $('#task-dialog-title').textContent = `${state.editingTaskId ? '编辑' : '新建'}${kind === 'range' ? '长期待办' : '当日事项'}`;
    $('#task-dialog-subtitle').textContent = kind === 'range' ? '设置日期区间；高优先级全程同步，其余仅在最后一周进入今日事项' : '记录当天临时事务，可按需启用具体时间';
  }

  function updateTaskTimeState(enabled) {
    $('#task-time-enabled').checked = enabled;
    $('#task-time').disabled = !enabled;
    $('#task-time-field').classList.toggle('enabled', enabled);
  }

  function updateTaskRangeDisplay() {
    $('#task-start-label').textContent = shortDate($('#task-start-date').value);
    $('#task-end-label').textContent = shortDate($('#task-end-date').value);
  }

  function renderRangePicker() {
    const year = state.rangePickerYear;
    const month = state.rangePickerMonth;
    $('#range-picker-title').textContent = `${year} 年 ${month + 1} 月`;
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const start = $('#task-start-date').value;
    const end = $('#task-end-date').value;
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const day = index - offset + 1;
      if (day < 1 || day > days) { cells.push('<span class="range-picker-blank"></span>'); continue; }
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const classes = ['range-picker-day'];
      if (date === start) classes.push('range-start');
      if (date === end) classes.push('range-end');
      if (start && end && date > start && date < end) classes.push('in-range');
      if (date === state.selectedDate) classes.push('range-today');
      cells.push(`<button type="button" class="${classes.join(' ')}" data-range-day="${day}" data-range-date="${date}">${day}</button>`);
    }
    $('#range-picker-grid').innerHTML = cells.join('');
    $('#range-picker-hint').textContent = !start ? '请选择开始日期' : !end ? '请选择结束日期' : `${shortDate(start)} 至 ${shortDate(end)} · 共 ${Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000) + 1} 天`;
    updateTaskRangeDisplay();
  }

  function selectRangeDate(date) {
    const start = $('#task-start-date').value;
    const end = $('#task-end-date').value;
    if (!start || (start && end) || !state.selectingRangeEnd) {
      $('#task-start-date').value = date;
      $('#task-end-date').value = '';
      state.selectingRangeEnd = true;
    } else if (date < start) {
      $('#task-start-date').value = date;
    } else {
      $('#task-end-date').value = date;
      state.selectingRangeEnd = false;
    }
    renderRangePicker();
  }

  function openTaskDialog(taskId = null, presetKind = 'range') {
    state.editingTaskId = taskId;
    const task = state.tasks.find((item) => item.id === taskId);
    const kind = task?.kind || presetKind;
    clearFieldErrors($('#task-form'));
    $('#task-id').value = task?.id || '';
    $('#task-title').value = task?.title || '';
    $('#task-date').value = task?.date || state.selectedDate;
    $('#task-start-date').value = task?.startDate || state.selectedDate;
    const defaultEnd = new Date(`${state.selectedDate}T12:00:00`);
    defaultEnd.setDate(defaultEnd.getDate() + 3);
    $('#task-end-date').value = task?.endDate || defaultEnd.toISOString().slice(0, 10);
    $('#task-time').value = task?.time || '10:30';
    updateTaskTimeState(kind === 'today' && Boolean(task?.time));
    $('#task-priority').value = task?.priority || 'normal';
    $('#task-notes').value = task?.notes || '';
    $('#task-reminder').checked = task ? Boolean(task.reminderId) : false;
    $('#task-delete').hidden = !task;
    state.rangePickerYear = Number($('#task-start-date').value.slice(0, 4));
    state.rangePickerMonth = Number($('#task-start-date').value.slice(5, 7)) - 1;
    state.selectingRangeEnd = false;
    $('#range-picker').hidden = true;
    updateTaskKind(kind);
    updateTaskRangeDisplay();
    renderRangePicker();
    $('#task-dialog').showModal();
    setTimeout(() => $('#task-title').focus(), 50);
  }

  function saveTask(event) {
    if (event.submitter?.value === 'cancel') return; // 「取消」按钮与右上角 ×：直接关闭弹窗，不做校验
    event.preventDefault();
    const title = $('#task-title').value.trim();
    const kind = $('#task-kind').value;
    clearFieldErrors($('#task-form'));
    if (!title) return setFieldError('task-title', '请输入任务标题');
    if (kind === 'range' && (!$('#task-start-date').value || !$('#task-end-date').value)) {
      $('#range-picker').hidden = false;
      toast('请选择完整的开始与结束日期', '!');
      return;
    }
    const taskData = {
      kind,
      title,
      date: kind === 'today' ? $('#task-date').value : undefined,
      startDate: kind === 'range' ? $('#task-start-date').value : undefined,
      endDate: kind === 'range' ? $('#task-end-date').value : undefined,
      time: kind === 'today' && $('#task-time-enabled').checked ? $('#task-time').value : '',
      priority: $('#task-priority').value,
      notes: $('#task-notes').value.trim(),
      completed: false
    };
    let task;
    if (state.editingTaskId) {
      task = state.tasks.find((item) => item.id === state.editingTaskId);
      Object.assign(task, taskData);
    } else {
      task = { id: uid('task'), ...taskData, reminderId: null };
      state.tasks.push(task);
    }
    if ($('#task-reminder').checked) {
      if (!task.reminderId) {
        task.reminderId = uid('reminder');
        const reminderDate = task.kind === 'range' ? task.startDate : task.date;
        state.reminders.push({ id: task.reminderId, title: task.title, type: 'absolute', value: task.time || '09:00', date: reminderDate, enabled: true, linkedTaskId: task.id });
      } else {
        Object.assign(state.reminders.find((item) => item.id === task.reminderId), { title: task.title, value: task.time || '09:00', date: task.kind === 'range' ? task.startDate : task.date });
      }
    } else if (task.reminderId) {
      state.reminders = state.reminders.filter((item) => item.id !== task.reminderId);
      task.reminderId = null;
    }
    $('#task-dialog').close();
    renderSchedule();
    toast(state.editingTaskId ? '任务已更新' : '任务已加入看板');
  }

  function completeTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.completed = true;
    if (task.reminderId) state.reminders = state.reminders.filter((item) => item.id !== task.reminderId);
    renderSchedule();
    toast('事项已完成并从当前视图移除');
  }

  function showTaskDeleteChoice(task) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = `删除“${task.title}”`;
    $('#confirm-subtitle').textContent = '该任务关联了定点提醒';
    $('#confirm-message').textContent = '请选择是否保留关联提醒。仅删除任务时，提醒会继续保留并解除关联。';
    $('#confirm-extra').innerHTML = '';
    $('#confirm-actions').innerHTML = '<button value="task-only" class="ghost-button" id="task-delete-only">仅删除任务</button><button value="task-and-reminder" class="danger-button" id="task-delete-with-reminder">任务和提醒一起删除</button>';
    return new Promise((resolve) => {
      const done = () => { dialog.removeEventListener('close', done); resolve(dialog.returnValue); };
      dialog.addEventListener('close', done);
      dialog.showModal();
    });
  }

  async function deleteTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    $('#task-dialog').close();
    let choice = 'task-only';
    if (task.reminderId) choice = await showTaskDeleteChoice(task);
    else {
      const ok = await showConfirm({ title: `删除“${task.title}”`, message: '任务删除后可通过刷新页面恢复示例数据。', confirmText: '删除任务' });
      choice = ok ? 'task-only' : 'cancel';
    }
    if (!['task-only', 'task-and-reminder'].includes(choice)) { openTaskDialog(taskId); return; }
    if (task.reminderId) {
      if (choice === 'task-and-reminder') state.reminders = state.reminders.filter((item) => item.id !== task.reminderId);
      else {
        const reminder = state.reminders.find((item) => item.id === task.reminderId);
        if (reminder) reminder.linkedTaskId = null;
      }
    }
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    renderSchedule();
    toast(choice === 'task-and-reminder' ? '任务和关联提醒已删除' : '任务已删除，提醒已保留');
  }

  function buildCalendar() {
    const year = state.calendarYear;
    const month = state.calendarMonth;
    $('#calendar-title').textContent = `${year} 年 ${month + 1} 月`;
    const first = new Date(year, month, 1);
    const mondayIndex = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousDays = new Date(year, month, 0).getDate();
    const calendarDays = [];
    for (let index = 0; index < 42; index += 1) {
      let day = index - mondayIndex + 1;
      let cellMonth = month;
      let cellYear = year;
      let muted = false;
      if (day < 1) { day = previousDays + day; cellMonth -= 1; muted = true; }
      if (day > daysInMonth && cellMonth === month) { day -= daysInMonth; cellMonth += 1; muted = true; }
      if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      const date = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      calendarDays.push({ day, date, muted });
    }

    const cells = calendarDays.map(({ day, date, muted }) => {
      const isToday = date === PROTOTYPE_TODAY;
      return `<button type="button" class="calendar-day ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${state.selectedDay === day && !muted ? 'selected' : ''}" data-day="${day}" data-date="${date}" ${muted ? 'data-muted="true"' : ''}>
        <b>${day}</b>
      </button>`;
    });
    $('#calendar-grid').innerHTML = cells.join('');
  }

  function openDayPanel(date) {
    const parsed = new Date(`${date}T12:00:00`);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    state.selectedDate = date;
    state.selectedDay = parsed.getDate();
    renderTasks();
    $('#day-panel-title').textContent = `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 · ${weekdays[parsed.getDay()]}`;
    const items = [
      ...state.tasks.filter((task) => !task.completed && (task.kind === 'today' ? task.date === date : isDateInRange(date, task.startDate, task.endDate))).map((task) => ({ type: 'task', source: task.kind, title: task.title, meta: task.kind === 'range' ? `区间 ${shortDate(task.startDate)}—${shortDate(task.endDate)}` : `${task.time || '全天'} · 当日新增` })),
      ...state.reminders.filter((reminder) => reminder.type === 'absolute' && reminder.date === date).map((reminder) => ({ type: 'reminder', title: reminder.title, meta: `${reminder.value} · 定点提醒` }))
    ];
    $('#day-panel-list').innerHTML = items.length ? items.map((item) => `<article><span class="day-item-icon ${item.type}">${item.type === 'task' ? '✓' : '◷'}</span><div>${item.source ? `<span class="day-source ${item.source}">${item.source === 'range' ? '区间任务' : '当日任务'}</span>` : ''}<strong>${esc(item.title)}</strong><small>${esc(item.meta)}</small></div></article>`).join('') : '<div class="day-empty"><span>☾</span><strong>当天没有安排</strong><p>留一点空白，也是一种节奏。</p></div>';
    $('#day-panel').classList.add('open');
    buildCalendar();
  }

  function renderReminders() {
    const typeName = { absolute: '定点提醒', interval: '周期提醒', usage: '使用时长' };
    const typeTone = { absolute: 'pink', interval: 'cyan', usage: 'gold' };
    const typeIcon = { absolute: '◉', interval: '◷', usage: '⌁' };
    $('#reminder-enabled-count').textContent = String(state.reminders.filter((item) => item.enabled).length);
    $('#reminder-list').innerHTML = state.reminders.map((reminder) => {
      const description = reminder.type === 'absolute' ? `${reminder.date === '2026-08-25' ? '今天' : reminder.date} ${reminder.value} · 显示在月历` : reminder.type === 'interval' ? `每 ${reminder.value} 分钟提醒一次` : `从应用启动时累计 · ${reminder.value} 分钟`;
      return `<article data-reminder-id="${reminder.id}"><span class="reminder-icon ${typeTone[reminder.type]}">${typeIcon[reminder.type]}</span><div><span class="type ${reminder.type === 'absolute' ? 'absolute' : reminder.type === 'usage' ? 'prompt' : 'command'}">${typeName[reminder.type]}</span>${reminder.linkedTaskId ? '<span class="linked-badge">已关联任务</span>' : ''}<h3>${esc(reminder.title)}</h3><p>${esc(description)}</p></div><label class="switch"><input type="checkbox" data-reminder-toggle="${reminder.id}" ${reminder.enabled ? 'checked' : ''}><i></i></label><button type="button" data-reminder-edit="${reminder.id}" aria-label="编辑提醒">•••</button></article>`;
    }).join('');
  }

  function updateReminderValueField() {
    const type = $('#reminder-type').value;
    const input = $('#reminder-value');
    $('#reminder-date-field').hidden = type !== 'absolute';
    $('#reminder-value-label').textContent = type === 'absolute' ? '提醒时间' : type === 'interval' ? '间隔分钟' : '累计分钟';
    input.type = type === 'absolute' ? 'time' : 'number';
    input.min = type === 'absolute' ? '' : '1';
    if (type !== 'absolute' && input.value.includes(':')) input.value = type === 'interval' ? '50' : '60';
  }

  function openReminderDialog(reminderId = null) {
    state.editingReminderId = reminderId;
    const reminder = state.reminders.find((item) => item.id === reminderId);
    clearFieldErrors($('#reminder-form'));
    $('#reminder-dialog-title').textContent = reminder ? '编辑提醒' : '新增提醒';
    $('#reminder-id').value = reminder?.id || '';
    $('#reminder-title').value = reminder?.title || '';
    $('#reminder-type').value = reminder?.type || 'absolute';
    updateReminderValueField();
    $('#reminder-date').value = reminder?.date || state.selectedDate;
    $('#reminder-value').value = reminder?.value || '16:30';
    $('#reminder-enabled').checked = reminder?.enabled ?? true;
    $('#reminder-delete').hidden = !reminder;
    $('#reminder-dialog').showModal();
  }

  function saveReminder(event) {
    if (event.submitter?.value === 'cancel') return; // 「取消」按钮与右上角 ×：直接关闭弹窗，不做校验
    event.preventDefault();
    const title = $('#reminder-title').value.trim();
    clearFieldErrors($('#reminder-form'));
    if (!title) return setFieldError('reminder-title', '请输入提醒内容');
    const type = $('#reminder-type').value;
    const data = { title, type, value: $('#reminder-value').value, enabled: $('#reminder-enabled').checked, date: type === 'absolute' ? $('#reminder-date').value : undefined };
    if (state.editingReminderId) Object.assign(state.reminders.find((item) => item.id === state.editingReminderId), data);
    else state.reminders.push({ id: uid('reminder'), ...data, linkedTaskId: null });
    $('#reminder-dialog').close();
    renderReminders();
    buildCalendar();
    toast(state.editingReminderId ? '提醒已更新' : '提醒已创建');
  }

  async function deleteReminder(reminderId) {
    const reminder = state.reminders.find((item) => item.id === reminderId);
    const ok = await showConfirm({ title: `删除“${reminder.title}”`, message: reminder.linkedTaskId ? '关联任务会保留，但不再到点提醒。' : '该提醒将从列表中移除。', confirmText: '删除提醒' });
    if (!ok) return;
    if (reminder.linkedTaskId) {
      const task = state.tasks.find((item) => item.id === reminder.linkedTaskId);
      if (task) task.reminderId = null;
    }
    state.reminders = state.reminders.filter((item) => item.id !== reminderId);
    $('#reminder-dialog').close();
    renderSchedule();
    toast('提醒已删除');
  }

  function showScheduleView(viewName) {
    $$('.schedule-view').forEach((view) => view.classList.toggle('active', view.id === `schedule-${viewName}`));
    $$('.schedule-view-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.scheduleView === viewName));
    $('#task-search').closest('.compact-search').classList.toggle('disabled', viewName !== 'board');
    if (viewName === 'board') renderTasks();
    if (viewName === 'calendar') buildCalendar();
    if (viewName === 'reminders') renderReminders();
  }

  function renderSchedule() {
    renderTasks();
    buildCalendar();
    renderReminders();
  }

  function bindEvents() {
    $$('.nav-item').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));

    $('#space-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-space]');
      if (!item) return;
      state.currentSpace = item.dataset.space;
      renderEntries();
    });
    $$('[data-open="space-create"]').forEach((button) => button.addEventListener('click', () => openSpaceDialog('create')));
    $$('[data-open="space-manage"]').forEach((button) => button.addEventListener('click', () => openSpaceDialog('manage')));
    $('#space-form').addEventListener('submit', saveSpace);
    $('#space-manager-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-space-edit]');
      const remove = event.target.closest('[data-space-delete]');
      const move = event.target.closest('[data-space-move]');
      if (edit) { $('#space-dialog').close(); openSpaceDialog('edit', edit.dataset.spaceEdit); }
      if (remove) deleteSpace(remove.dataset.spaceDelete);
      if (move) {
        const index = state.spaces.findIndex((item) => item.id === move.dataset.spaceMove);
        const target = move.dataset.direction === 'up' ? index - 1 : index + 1;
        if (target >= 0 && target < state.spaces.length) [state.spaces[index], state.spaces[target]] = [state.spaces[target], state.spaces[index]];
        renderEntries(); renderSpaceManager(); renderNotes();
      }
    });

    $$('[data-open="entry-create"]').forEach((button) => button.addEventListener('click', () => openEntryDrawer()));
    $('#entry-form').addEventListener('submit', saveEntry);
    $('#entry-drawer-close').addEventListener('click', closeEntryDrawer);
    $('#drawer-backdrop').addEventListener('click', closeEntryDrawer);
    $('#entry-content').addEventListener('input', () => { $('#entry-char-count').textContent = `${$('#entry-content').value.length} / 2000`; });
    $('#entry-type').addEventListener('change', () => { $('#entry-drawer-type').textContent = $('#entry-type').value === 'command' ? '常用命令' : '提示词'; });
    $('#entry-cover').addEventListener('change', updateCoverPreview);
    $('#entry-cover-file').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('请选择 PNG、JPEG 或 WebP 图片', '!');
      if (file.size > 5 * 1024 * 1024) return toast('例图不能超过 5MB', '!');
      const reader = new FileReader();
      reader.onload = () => { state.customCover = reader.result; $('#entry-cover').value = 'image'; updateCoverPreview(); toast('图片已载入，卡片已切换为带图样式'); };
      reader.readAsDataURL(file);
    });
    $('#entry-copy').addEventListener('click', () => copyText($('#entry-content').value, '正文'));
    $('#entry-delete').addEventListener('click', async () => {
      const entry = state.entries.find((item) => item.id === state.editingEntryId);
      const ok = await showConfirm({ title: `删除“${entry.title}”`, message: '原型刷新后会恢复示例数据，但当前会话中的修改会被移除。', confirmText: '删除内容' });
      if (!ok) return;
      state.entries = state.entries.filter((item) => item.id !== entry.id);
      closeEntryDrawer(); renderEntries(); toast('内容已删除');
    });
    $('#prompt-grid').addEventListener('click', (event) => {
      const imageCopy = event.target.closest('[data-entry-image-copy]');
      const copy = event.target.closest('[data-entry-copy]');
      const card = event.target.closest('[data-entry-id]');
      if (imageCopy) { event.stopPropagation(); const entry = state.entries.find((item) => item.id === imageCopy.dataset.entryImageCopy); copyEntryImage(entry); return; }
      if (copy) { event.stopPropagation(); const entry = state.entries.find((item) => item.id === copy.dataset.entryCopy); copyText(entry.content, entry.type === 'command' ? '命令' : '提示词'); return; }
      if (card) openEntryDrawer(card.dataset.entryId);
    });
    $('#prompt-grid').addEventListener('dblclick', (event) => {
      const card = event.target.closest('[data-entry-id]');
      if (card && (event.target.matches('p, pre'))) copyText(state.entries.find((item) => item.id === card.dataset.entryId).content, '正文');
    });
    $('#prompt-search').addEventListener('input', (event) => { state.search = event.target.value; renderEntries(); });
    $$('.filter-chip').forEach((button) => button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      $$('.filter-chip').forEach((node) => node.classList.toggle('active', node === button));
      renderEntries();
    }));
    $('#entry-sort').addEventListener('change', (event) => { state.sort = event.target.value; renderEntries(); });
    $('[data-clear-filter]').addEventListener('click', () => { state.filter = 'all'; state.search = ''; $('#prompt-search').value = ''; $$('.filter-chip').forEach((node) => node.classList.toggle('active', node.dataset.filter === 'all')); renderEntries(); });

    $('#note-space-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-note-space]');
      if (!item) return;
      state.currentNoteSpace = item.dataset.noteSpace;
      renderNotes();
    });
    $$('[data-open="note-create"]').forEach((button) => button.addEventListener('click', createNote));
    $('#note-search').addEventListener('input', (event) => { state.noteSearch = event.target.value; renderNotes(); });
    $('#note-sort').addEventListener('change', (event) => { state.noteSort = event.target.value; renderNotes(); });
    $('#note-grid').addEventListener('click', (event) => {
      const card = event.target.closest('[data-note-id]');
      if (card) openNoteEditor(card.dataset.noteId);
    });
    $('[data-note-back]').addEventListener('click', closeNoteEditor);
    $('#note-delete').addEventListener('click', deleteNote);
    $('#note-title').addEventListener('input', noteDraftChanged);
    $('#note-content').addEventListener('input', noteDraftChanged);

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); showPage('prompts'); $('#prompt-search').focus(); }
      if (event.key === 'Escape' && $('#entry-drawer').classList.contains('open')) closeEntryDrawer();
    });

    $$('[data-open="task-create"]').forEach((button) => button.addEventListener('click', () => openTaskDialog(null, 'range')));
    $$('[data-quick-task]').forEach((button) => button.addEventListener('click', () => openTaskDialog(null, button.dataset.quickTask)));
    $('#task-form').addEventListener('submit', saveTask);
    $('#task-delete').addEventListener('click', () => deleteTask(state.editingTaskId));
    $('#task-search').addEventListener('input', renderTasks);
    $('#task-time-enabled').addEventListener('change', (event) => updateTaskTimeState(event.target.checked));
    $('#task-range-trigger').addEventListener('click', () => {
      $('#range-picker').hidden = !$('#range-picker').hidden;
      if (!$('#range-picker').hidden) renderRangePicker();
    });
    $('#range-picker-grid').addEventListener('click', (event) => {
      const day = event.target.closest('[data-range-date]');
      if (day) selectRangeDate(day.dataset.rangeDate);
    });
    $$('[data-range-month]').forEach((button) => button.addEventListener('click', () => {
      state.rangePickerMonth += Number(button.dataset.rangeMonth);
      if (state.rangePickerMonth < 0) { state.rangePickerMonth = 11; state.rangePickerYear -= 1; }
      if (state.rangePickerMonth > 11) { state.rangePickerMonth = 0; state.rangePickerYear += 1; }
      renderRangePicker();
    }));
    $('#range-clear').addEventListener('click', () => {
      $('#task-start-date').value = '';
      $('#task-end-date').value = '';
      state.selectingRangeEnd = false;
      renderRangePicker();
    });
    $('#range-today').addEventListener('click', () => {
      state.rangePickerYear = 2026;
      state.rangePickerMonth = 7;
      selectRangeDate('2026-08-25');
    });
    $$('.task-list').forEach((list) => {
      list.addEventListener('click', (event) => {
        const complete = event.target.closest('[data-task-complete]');
        if (complete) { event.stopPropagation(); completeTask(complete.dataset.taskComplete); return; }
        const card = event.target.closest('[data-task-id]');
        if (card) openTaskDialog(card.dataset.taskId);
      });
    });
    $$('[data-date-step]').forEach((button) => button.addEventListener('click', () => {
      const date = new Date(`${state.selectedDate}T12:00:00`); date.setDate(date.getDate() + Number(button.dataset.dateStep)); state.selectedDate = date.toISOString().slice(0, 10); renderTasks();
    }));
    $('[data-date-today]').addEventListener('click', () => { state.selectedDate = '2026-08-25'; renderTasks(); });
    $$('[data-schedule-view]').forEach((button) => button.addEventListener('click', () => showScheduleView(button.dataset.scheduleView)));
    $$('[data-month-step]').forEach((button) => button.addEventListener('click', () => {
      state.calendarMonth += Number(button.dataset.monthStep);
      if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
      if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
      state.selectedDay = null; $('#day-panel').classList.remove('open'); buildCalendar();
    }));
    $('#calendar-grid').addEventListener('click', (event) => { const day = event.target.closest('.calendar-day'); if (day && !day.dataset.muted) openDayPanel(day.dataset.date); });
    $('#day-panel-close').addEventListener('click', () => $('#day-panel').classList.remove('open'));

    $$('[data-open="reminder-create"]').forEach((button) => button.addEventListener('click', () => openReminderDialog()));
    $('#reminder-form').addEventListener('submit', saveReminder);
    $('#reminder-type').addEventListener('change', updateReminderValueField);
    $('#reminder-delete').addEventListener('click', () => deleteReminder(state.editingReminderId));
    $('#reminder-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-reminder-edit]'); if (edit) openReminderDialog(edit.dataset.reminderEdit); });
    $('#reminder-list').addEventListener('change', (event) => {
      const toggle = event.target.closest('[data-reminder-toggle]');
      if (!toggle) return;
      state.reminders.find((item) => item.id === toggle.dataset.reminderToggle).enabled = toggle.checked;
      renderReminders(); toast(toggle.checked ? '提醒已启用' : '提醒已暂停');
    });

    $('#volume-input').addEventListener('input', (event) => { $('#volume-value').textContent = `${event.target.value}%`; setSavedState('音量已保存'); });
    $('#default-page-setting').addEventListener('change', (event) => {
      state.defaultPage = event.target.value;
      showPage(state.defaultPage);
      toast(`默认打开界面已设为「${state.defaultPage === 'notes' ? '记事本' : '提示词管理工具'}」`);
    });
    $$('[data-setting]').forEach((input) => input.addEventListener('change', () => setSavedState('设置已保存')));
    $('#model-save').addEventListener('click', () => {
      const endpoint = $('#model-endpoint').value.trim();
      if (!/^https?:\/\//i.test(endpoint)) { $('#model-endpoint').classList.add('error'); $('#endpoint-message').textContent = '请输入以 http:// 或 https:// 开头的地址'; return; }
      $('#model-endpoint').classList.remove('error'); $('#endpoint-message').textContent = '配置已验证，原型不会发起连接'; setSavedState('大模型配置已保存'); toast('配置已验证（未发起网络请求）');
    });
    $$('[data-demo-action]').forEach((button) => button.addEventListener('click', () => toast('正式应用将在这里打开数据目录')));
    $$('[data-window-action]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.windowAction === 'maximize') { $('.app-window').classList.toggle('maximized'); toast($('.app-window').classList.contains('maximized') ? '已模拟最大化窗口' : '已模拟还原窗口'); }
      else toast(button.dataset.windowAction === 'minimize' ? '已模拟最小化操作' : '评审原型不会关闭窗口');
    }));
    $$('[data-confirm-action]').forEach((button) => button.addEventListener('click', async () => {
      const clear = button.dataset.confirmAction === 'clear-history';
      const ok = await showConfirm({ title: clear ? '清空对话历史' : '退出应用', message: clear ? '此操作仅演示二次确认，不会删除真实数据。' : '评审原型不会实际退出桌面应用。', confirmText: clear ? '确认清空' : '确认退出' });
      if (ok) toast(clear ? '已模拟清空对话历史' : '已模拟退出操作');
    }));
    $('[data-reset-demo]').addEventListener('click', async () => {
      const ok = await showConfirm({ title: '恢复示例数据', message: '当前页面内完成的新增、编辑与完成操作会恢复为初始状态。', confirmText: '恢复示例' });
      if (ok) location.reload();
    });
  }

  function applyQueryState() {
    const params = new URLSearchParams(location.search);
    const page = params.get('page');
    if (['prompts', 'notes', 'schedule', 'settings'].includes(page)) showPage(page);
    const view = params.get('view');
    if (page === 'schedule' && ['board', 'calendar', 'reminders'].includes(view)) showScheduleView(view);
    if (params.get('drawer') === '1') openEntryDrawer(state.entries[0].id);
    if (params.get('compose') === '1') openEntryDrawer();
    const noteParam = params.get('note');
    if (noteParam) {
      const noteId = noteParam === '1' ? state.notes[0]?.id : noteParam;
      if (noteId) openNoteEditor(noteId);
    }
    if (['range', 'today', '1'].includes(params.get('task'))) openTaskDialog(null, params.get('task') === 'today' ? 'today' : 'range');
    if (params.get('picker') === '1') { $('#range-picker').hidden = false; renderRangePicker(); }
    if (params.get('reminder') === '1') openReminderDialog();
    if (params.get('day')) openDayPanel(`2026-08-${String(params.get('day')).padStart(2, '0')}`);
  }

  renderEntries();
  renderNotes();
  renderSchedule();
  bindEvents();
  applyQueryState();
})();
