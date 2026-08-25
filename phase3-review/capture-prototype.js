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

const screens = [
  ['01-提示词管理.png', 'page=prompts'],
  ['02-卡片详情抽屉.png', 'page=prompts&drawer=1'],
  ['03-每日任务看板.png', 'page=schedule&view=board'],
  ['04-日程表.png', 'page=schedule&view=calendar'],
  ['05-设置.png', 'page=settings']
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#081326',
    webPreferences: { offscreen: true }
  });

  const htmlUrl = pathToFileURL(path.join(__dirname, '界面示例.html')).href;
  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });

  await win.loadURL(`${htmlUrl}?page=prompts`);
  const smoke = await win.webContents.executeJavaScript(`(() => {
    const click = (selector) => document.querySelector(selector).click();
    const navLabels = [...document.querySelectorAll('.nav-item')].map((item) => item.textContent.trim());
    click('[data-filter="command"]');
    const commandCount = [...document.querySelectorAll('.prompt-card')].filter((card) => !card.classList.contains('hidden-card')).length;
    click('[data-filter="all"]');
    click('.prompt-card');
    const drawerOpened = document.querySelector('.detail-drawer').classList.contains('open');
    click('#drawer-close');
    click('[data-page="schedule"]');
    const scheduleOpened = document.querySelector('#page-schedule').classList.contains('active');
    click('[data-schedule-view="calendar"]');
    const calendarOpened = document.querySelector('#schedule-calendar').classList.contains('active');
    click('[data-page="settings"]');
    const settingsOpened = document.querySelector('#page-settings').classList.contains('active');
    return { navLabels, commandCount, drawerOpened, scheduleOpened, calendarOpened, settingsOpened };
  })()`);
  const expectedNav = ['✦提示词管理工具', '◫日程管理', '⚙设置'];
  if (JSON.stringify(smoke.navLabels) !== JSON.stringify(expectedNav)
      || smoke.commandCount !== 3
      || !smoke.drawerOpened
      || !smoke.scheduleOpened
      || !smoke.calendarOpened
      || !smoke.settingsOpened) {
    throw new Error(`Prototype interaction smoke failed: ${JSON.stringify(smoke)}`);
  }
  console.log('Interaction QA:', smoke);

  for (const [name, query] of screens) {
    await win.loadURL(`${htmlUrl}?${query}`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (query.includes('drawer=1')) {
      const metrics = await win.webContents.executeJavaScript(`(() => {
        const appRect = document.querySelector('.app-window').getBoundingClientRect();
        const drawerRect = document.querySelector('.detail-drawer').getBoundingClientRect();
        return { viewport: [innerWidth, innerHeight], app: [appRect.left, appRect.right], drawer: [drawerRect.left, drawerRect.right, drawerRect.width] };
      })()`);
      console.log('Drawer QA:', metrics);
    }
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshots', name), image.toPNG());
  }

  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
