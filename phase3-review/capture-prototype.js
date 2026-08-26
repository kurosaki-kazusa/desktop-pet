const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', path.join(__dirname, '.electron-qa'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const htmlUrl = pathToFileURL(path.join(__dirname, '界面示例.html')).href;
const outputDir = path.join(__dirname, 'screenshots');

const screens = [
  ['01-提示词管理.png', 'page=prompts', 1280, 820],
  ['02-新建内容抽屉.png', 'page=prompts&compose=1', 1280, 820],
  ['03-内容详情编辑.png', 'page=prompts&drawer=1', 1280, 820],
  ['04-长期待办与今日事项.png', 'page=schedule&view=board', 1280, 820],
  ['05-待办日期区间选择.png', 'page=schedule&view=board&task=range&picker=1', 1280, 820],
  ['05B-当日事项表单.png', 'page=schedule&view=board&task=today', 1280, 820],
  ['06-日程表日期详情.png', 'page=schedule&view=calendar&day=25', 1280, 820],
  ['07-提醒管理.png', 'page=schedule&view=reminders', 1280, 820],
  ['08-新增定点提醒弹窗.png', 'page=schedule&view=reminders&reminder=1', 1280, 820],
  ['09-设置.png', 'page=settings', 1280, 820],
  ['10-最小尺寸适配.png', 'page=prompts', 960, 640]
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runInteractionQA(win) {
  await win.loadURL(`${htmlUrl}?page=prompts`);

  const shell = await win.webContents.executeJavaScript(`(() => ({
    nav: [...document.querySelectorAll('.nav-item')].map((node) => node.textContent.trim()),
    windowOnly: !document.querySelector('.pet, .pet-stage, .desktop-pet'),
    initialEntries: document.querySelectorAll('.prompt-card').length,
    resourceLoaded: Boolean(document.querySelector('.app-mark')?.naturalWidth),
    baseFont: parseFloat(getComputedStyle(document.body).fontSize)
  }))()`);
  assert(JSON.stringify(shell.nav) === JSON.stringify(['提示词管理工具', '日程管理', '设置']), `顶部导航不符合要求：${JSON.stringify(shell.nav)}`);
  assert(shell.windowOnly, '窗口原型中不应包含桌宠部分');
  assert(shell.initialEntries >= 6, '提示词案例数量不足');
  assert(shell.resourceLoaded, '主题标识资源未正确加载');
  assert(shell.baseFont >= 14, `整体字体仍然偏小：${shell.baseFont}px`);
  console.log('QA checkpoint: shell');

  const promptFlow = await win.webContents.executeJavaScript(`(async () => {
    const click = (selector) => document.querySelector(selector)?.click();
    const waitUntil = async (predicate) => { for (let i = 0; i < 20; i += 1) { if (predicate()) return true; await new Promise((resolve) => setTimeout(resolve, 40)); } return false; };
    click('[data-open="entry-create"]');
    const opened = document.querySelector('#entry-drawer')?.classList.contains('open');
    const favoriteUiRemoved = !document.querySelector('#entry-favorite') && !document.querySelector('[data-entry-favorite]');
    const coverOptions = JSON.stringify([...document.querySelectorAll('#entry-cover option')].map((option) => [option.value, option.textContent]));
    const defaultCompact = document.querySelector('#entry-cover').value === 'none' && document.querySelector('#entry-cover-preview').classList.contains('no-cover-preview');
    document.querySelector('#entry-title').value = '课堂演示检查清单';
    document.querySelector('#entry-content').value = '核对导航、表单、空状态与最小窗口。';
    click('#entry-save');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const created = [...document.querySelectorAll('.prompt-card h3')].some((node) => node.textContent === '课堂演示检查清单');
    const createdCard = [...document.querySelectorAll('.prompt-card')].find((node) => node.querySelector('h3')?.textContent === '课堂演示检查清单');
    const createdCompact = createdCard.classList.contains('compact') && !createdCard.querySelector('.cover');
    createdCard.click();
    document.querySelector('#entry-title').value = '课堂演示验收清单';
    document.querySelector('#entry-cover').value = 'image';
    document.querySelector('#entry-cover').dispatchEvent(new Event('change', { bubbles: true }));
    click('#entry-save');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const edited = [...document.querySelectorAll('.prompt-card h3')].some((node) => node.textContent === '课堂演示验收清单');
    const editedCard = [...document.querySelectorAll('.prompt-card')].find((node) => node.querySelector('h3')?.textContent === '课堂演示验收清单');
    const compactUpgradedToFeatured = editedCard.classList.contains('featured') && Boolean(editedCard.querySelector('.cover'));
    const imageCopyOnlyOnFeatured = [...document.querySelectorAll('.prompt-card.featured')].every((card) => card.querySelector('[data-entry-image-copy]'))
      && [...document.querySelectorAll('.prompt-card.compact')].every((card) => !card.querySelector('[data-entry-image-copy]'));
    const featuredHeights = [...document.querySelectorAll('.prompt-card.featured')].map((card) => card.getBoundingClientRect().height);
    const compactHeights = [...document.querySelectorAll('.prompt-card.compact')].map((card) => card.getBoundingClientRect().height);
    const fixedCardSizes = Math.max(...featuredHeights) - Math.min(...featuredHeights) < 0.5
      && Math.max(...compactHeights) - Math.min(...compactHeights) < 0.5;
    const textQuotas = getComputedStyle(document.querySelector('.prompt-card.featured .card-copy')).webkitLineClamp === '3'
      && getComputedStyle(document.querySelector('.prompt-card.compact .card-copy')).webkitLineClamp === '4';
    window.__imageCopies = 0;
    if (typeof ClipboardItem === 'undefined') window.ClipboardItem = class { constructor(data) { this.data = data; } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {}, write: async (items) => { window.__imageCopies += items.length; } } });
    editedCard.querySelector('[data-entry-image-copy]').click();
    const imageCopied = await waitUntil(() => window.__imageCopies === 1);
    const imageCopyDidNotOpenDrawer = !document.querySelector('#entry-drawer').classList.contains('open');
    editedCard.click();
    click('#entry-delete');
    await new Promise((resolve) => setTimeout(resolve, 80));
    click('#confirm-primary');
    await waitUntil(() => ![...document.querySelectorAll('.prompt-card h3')].some((node) => node.textContent === '课堂演示验收清单'));
    const deleted = ![...document.querySelectorAll('.prompt-card h3')].some((node) => node.textContent === '课堂演示验收清单');
    click('[data-open="space-create"]');
    document.querySelector('#space-name').value = '课程演示';
    click('#space-save');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const spaceCreated = [...document.querySelectorAll('.space-item')].some((node) => node.textContent.includes('课程演示'));
    return { opened, favoriteUiRemoved, coverOptions, defaultCompact, created, createdCompact, edited, compactUpgradedToFeatured, imageCopyOnlyOnFeatured, fixedCardSizes, textQuotas, imageCopied, imageCopyDidNotOpenDrawer, deleted, spaceCreated, entries: document.querySelectorAll('.prompt-card').length };
  })()`);
  assert(promptFlow.opened && promptFlow.created && promptFlow.edited && promptFlow.deleted, `内容 CRUD 流程失败：${JSON.stringify(promptFlow)}`);
  assert(promptFlow.favoriteUiRemoved, `收藏功能未完整移除：${JSON.stringify(promptFlow)}`);
  assert(promptFlow.coverOptions === JSON.stringify([['image', '包含图片的卡片'], ['none', '无图片的紧凑卡片']]), `封面选项不符合要求：${promptFlow.coverOptions}`);
  assert(promptFlow.defaultCompact && promptFlow.createdCompact && promptFlow.compactUpgradedToFeatured, `卡片形态切换失败：${JSON.stringify(promptFlow)}`);
  assert(promptFlow.imageCopyOnlyOnFeatured && promptFlow.imageCopied && promptFlow.imageCopyDidNotOpenDrawer, `图片快速复制失败：${JSON.stringify(promptFlow)}`);
  assert(promptFlow.fixedCardSizes && promptFlow.textQuotas, `卡片尺寸或文字定额失败：${JSON.stringify(promptFlow)}`);
  assert(promptFlow.spaceCreated, `空间新增流程失败：${JSON.stringify(promptFlow)}`);
  console.log('QA checkpoint: prompt CRUD');

  await win.loadURL(`${htmlUrl}?page=prompts`);
  const resetEntries = await win.webContents.executeJavaScript(`document.querySelectorAll('.prompt-card').length`);
  assert(resetEntries === shell.initialEntries, '刷新后应恢复预置案例数据，不得持久化原型改动');

  const lastSpaceGuard = await win.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
    while (document.querySelectorAll('.space-item:not(.system)').length > 1) {
      document.querySelector('[data-open="space-manage"]').click();
      const remove = document.querySelector('[data-space-delete]:not(:disabled)');
      remove.click();
      await pause();
      document.querySelector('#confirm-primary').click();
      await pause();
    }
    document.querySelector('[data-open="space-manage"]').click();
    const lastDelete = document.querySelector('[data-space-delete]');
    const guarded = lastDelete?.disabled && lastDelete?.title.includes('至少保留一个');
    document.querySelector('#space-dialog').close();
    return { spaces: document.querySelectorAll('.space-item:not(.system)').length, guarded };
  })()`);
  assert(lastSpaceGuard.spaces === 1 && lastSpaceGuard.guarded, `最后空间删除保护失败：${JSON.stringify(lastSpaceGuard)}`);
  console.log('QA checkpoint: space guard');

  await win.loadURL(`${htmlUrl}?page=prompts`);

  const scheduleFlow = await win.webContents.executeJavaScript(`(async () => {
    const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitUntil = async (predicate) => { for (let i = 0; i < 20; i += 1) { if (predicate()) return true; await pause(40); } return false; };
    const hasTitle = (root, title) => [...document.querySelectorAll(root + ' .task-card h3')].some((node) => node.textContent === title);
    const isHidden = (selector) => document.querySelector(selector).hidden && getComputedStyle(document.querySelector(selector)).display === 'none';
    const isVisible = (selector) => !document.querySelector(selector).hidden && getComputedStyle(document.querySelector(selector)).display !== 'none';
    document.querySelector('[data-page="schedule"]').click();
    const columnLabels = [...document.querySelectorAll('.kanban-column > header strong')].map((node) => node.textContent.trim());
    const noCompletedColumn = !document.querySelector('[data-status="done"]');
    const rangeMirrored = document.querySelectorAll('[data-task-id="task-review"]').length === 2;
    const noTaskKindSwitcher = !document.querySelector('.task-kind-switch') && !document.querySelector('[data-task-kind]');
    const normalPriorityDeferred = !hasTitle('[data-task-list="today"]', '整理本周灵感');
    for (let i = 0; i < 5; i += 1) document.querySelector('[data-date-step="1"]').click();
    const normalPriorityFinalWeek = hasTitle('[data-task-list="today"]', '整理本周灵感');
    document.querySelector('[data-date-today]').click();

    document.querySelector('[data-open="task-create"]').click();
    const rangeTaskOpened = document.querySelector('#task-dialog')?.open
      && document.querySelector('#task-kind').value === 'range'
      && isVisible('#task-range-field')
      && isHidden('#task-date-field')
      && isHidden('#task-time-field')
      && document.querySelector('#task-reminder').checked === false;
    document.querySelector('#task-title').value = '三期课程连续准备';
    document.querySelector('#task-range-trigger').click();
    document.querySelector('[data-range-day="24"]').click();
    document.querySelector('[data-range-day="28"]').click();
    const rangeSelected = document.querySelector('#task-start-date').value === '2026-08-24' && document.querySelector('#task-end-date').value === '2026-08-28';
    const hotelRangeStyle = Boolean(document.querySelector('.range-picker-day.range-start') && document.querySelector('.range-picker-day.range-end') && document.querySelector('.range-picker-day.in-range'));
    document.querySelector('#task-save').click();
    await pause();
    const rangeInTodo = hasTitle('[data-task-list="range"]', '三期课程连续准备');
    const rangeInToday = hasTitle('[data-task-list="today"]', '三期课程连续准备');

    document.querySelector('[data-quick-task="today"]').click();
    const todayTaskOpened = document.querySelector('#task-kind').value === 'today'
      && isHidden('#task-range-field')
      && isVisible('#task-date-field')
      && isVisible('#task-time-field')
      && document.querySelector('#task-time-enabled').checked === false
      && document.querySelector('#task-time').disabled === true
      && document.querySelector('#task-reminder').checked === false;
    document.querySelector('#task-title').value = '临时回复评审意见';
    document.querySelector('#task-time-enabled').click();
    const optionalTimeEnabled = document.querySelector('#task-time-enabled').checked === true
      && document.querySelector('#task-time').disabled === false
      && document.querySelector('#task-time-field').classList.contains('enabled');
    document.querySelector('#task-time').value = '15:20';
    document.querySelector('#task-save').click();
    await pause();
    const todayOnly = hasTitle('[data-task-list="today"]', '临时回复评审意见') && !hasTitle('[data-task-list="range"]', '临时回复评审意见');
    const createdTodayCard = [...document.querySelectorAll('[data-task-list="today"] .task-card')].find((node) => node.querySelector('h3')?.textContent === '临时回复评审意见');
    const todayTimeSaved = createdTodayCard?.querySelector('footer')?.textContent.includes('15:20');
    createdTodayCard.click();
    const editTimeRestored = document.querySelector('#task-time-enabled').checked
      && document.querySelector('#task-time').disabled === false
      && document.querySelector('#task-time').value === '15:20';
    document.querySelector('#task-dialog').close();
    const originBadges = Boolean(document.querySelector('[data-task-list="today"] .task-origin.range') && document.querySelector('[data-task-list="today"] .task-origin.today'));

    for (let i = 0; i < 3; i += 1) document.querySelector('[data-date-step="1"]').click();
    const rangeStillInTodayAtEnd = hasTitle('[data-task-list="today"]', '三期课程连续准备');
    const steppedDateLabel = document.querySelector('[data-date-today]').textContent.includes('8月28日') && !document.querySelector('[data-date-today]').textContent.includes('今天');
    document.querySelector('[data-date-step="1"]').click();
    const rangeLeavesTodayAfterEnd = !hasTitle('[data-task-list="today"]', '三期课程连续准备') && hasTitle('[data-task-list="range"]', '三期课程连续准备');
    document.querySelector('[data-date-today]').click();

    const completeButton = [...document.querySelectorAll('[data-task-list="today"] .task-card')].find((node) => node.querySelector('h3')?.textContent === '临时回复评审意见')?.querySelector('[data-task-complete]');
    completeButton.click();
    await waitUntil(() => !hasTitle('[data-task-list="today"]', '临时回复评审意见'));
    const completedRemoved = !hasTitle('[data-task-list="today"]', '临时回复评审意见');

    document.querySelector('[data-schedule-view="calendar"]').click();
    const calendarHasNoTaskHints = document.querySelectorAll('#calendar-grid .event').length === 0;
    document.querySelector('.calendar-day[data-date="2026-08-27"]').click();
    document.querySelector('[data-schedule-view="board"]').click();
    const calendarBoardSynced = document.querySelector('[data-date-today]').textContent.includes('8月27日') && hasTitle('[data-task-list="today"]', '准备课程演示素材') && !hasTitle('[data-task-list="today"]', '临时同步视觉细节');
    document.querySelector('[data-schedule-view="calendar"]').click();
    document.querySelector('.calendar-day[data-day="25"]').click();
    const dayOpened = document.querySelector('#day-panel')?.classList.contains('open');
    const daySources = Boolean(document.querySelector('#day-panel-list .day-source.range'));

    document.querySelector('[data-schedule-view="reminders"]').click();
    document.querySelector('[data-open="reminder-create"]').click();
    const reminderOpened = document.querySelector('#reminder-dialog')?.open;
    const reminderDateVisible = !document.querySelector('#reminder-date-field')?.hidden;
    document.querySelector('#reminder-title').value = '检查课程评审';
    document.querySelector('#reminder-date').value = '2026-08-28';
    document.querySelector('#reminder-value').value = '18:00';
    document.querySelector('#reminder-save').click();
    await pause();
    const reminderCreated = [...document.querySelectorAll('#reminder-list h3')].some((node) => node.textContent === '检查课程评审');
    const toggledReminderTitle = document.querySelector('[data-reminder-toggle]').closest('article').querySelector('h3').textContent;
    const reminderWasEnabled = document.querySelector('[data-reminder-toggle]').checked;
    document.querySelector('[data-reminder-toggle]').click();
    const toggledReminder = [...document.querySelectorAll('#reminder-list article')].find((node) => node.querySelector('h3')?.textContent === toggledReminderTitle);
    const reminderToggled = Boolean(toggledReminder) && toggledReminder.querySelector('[data-reminder-toggle]').checked !== reminderWasEnabled;

    document.querySelector('[data-schedule-view="board"]').click();
    document.querySelector('[data-task-list="range"] [data-task-id="task-review"]').click();
    document.querySelector('#task-delete').click();
    await pause();
    const deleteChoices = Boolean(document.querySelector('#task-delete-only') && document.querySelector('#task-delete-with-reminder'));
    document.querySelector('#task-delete-only')?.click();
    await waitUntil(() => !document.querySelector('[data-task-id="task-review"]'));
    document.querySelector('[data-schedule-view="reminders"]').click();
    const keptReminder = [...document.querySelectorAll('#reminder-list article')].find((node) => node.querySelector('h3')?.textContent === '三期方案评审');
    const reminderKeptAndUnlinked = Boolean(keptReminder) && keptReminder.querySelector('.linked-badge') === null;

    return { columnLabels: JSON.stringify(columnLabels), noCompletedColumn, rangeMirrored, noTaskKindSwitcher, normalPriorityDeferred, normalPriorityFinalWeek, rangeTaskOpened, rangeSelected, hotelRangeStyle, rangeInTodo, rangeInToday, todayTaskOpened, optionalTimeEnabled, todayOnly, todayTimeSaved, editTimeRestored, originBadges, rangeStillInTodayAtEnd, steppedDateLabel, rangeLeavesTodayAfterEnd, completedRemoved, calendarHasNoTaskHints, calendarBoardSynced, dayOpened, daySources, reminderOpened, reminderDateVisible, reminderCreated, reminderToggled, deleteChoices, reminderKeptAndUnlinked };
  })()`);
  assert(scheduleFlow.columnLabels === JSON.stringify(['长期待办', '今日事项']), `看板栏目不符合新方案：${scheduleFlow.columnLabels}`);
  assert(Object.values(scheduleFlow).every(Boolean), `日程完整流程失败：${JSON.stringify(scheduleFlow)}`);
  console.log('QA checkpoint: schedule flow');

  const settingsFlow = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-page="settings"]').click();
    const volume = document.querySelector('#volume-input');
    volume.value = '35';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#model-endpoint').value = 'not-a-url';
    document.querySelector('#model-save').click();
    const invalidBlocked = document.querySelector('#model-endpoint').classList.contains('error');
    document.querySelector('#model-endpoint').value = 'https://api.deepseek.com';
    document.querySelector('#model-save').click();
    return {
      volume: document.querySelector('#volume-value')?.textContent,
      state: document.querySelector('#save-state')?.textContent,
      noSubnav: !document.querySelector('#page-settings .tabs, #page-settings [role="tablist"]'),
      invalidBlocked
    };
  })()`);
  assert(settingsFlow.volume === '35%', `音量反馈错误：${JSON.stringify(settingsFlow)}`);
  assert(settingsFlow.state.includes('已保存') && settingsFlow.noSubnav && settingsFlow.invalidBlocked, `设置页结构或反馈错误：${JSON.stringify(settingsFlow)}`);

  return { shell, promptFlow, scheduleFlow, settingsFlow };
}

async function captureScreens(win) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, query, width, height] of screens) {
    win.setSize(width, height);
    await win.loadURL(`${htmlUrl}?${query}`);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const layout = await win.webContents.executeJavaScript(`(() => ({
      viewport: [innerWidth, innerHeight],
      bodyOverflow: document.documentElement.scrollWidth > innerWidth,
      reminderDialogOpen: document.querySelector('#reminder-dialog')?.open || false,
      rangePickerOpen: document.querySelector('#range-picker')?.hidden === false,
      app: (() => { const r = document.querySelector('.app-window').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()
    }))()`);
    assert(!layout.bodyOverflow, `${name} 存在横向溢出：${JSON.stringify(layout)}`);
    if (query.includes('reminder=1')) assert(layout.reminderDialogOpen, `${name} 未打开提醒表单`);
    if (query.includes('picker=1')) assert(layout.rangePickerOpen, `${name} 未打开日期区间选择器`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, name), image.toPNG());
    console.log(`Visual QA ${name}:`, layout);
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#081326',
    webPreferences: { offscreen: true }
  });

  const qa = await runInteractionQA(win);
  console.log('Interaction QA:', qa);
  await captureScreens(win);
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
