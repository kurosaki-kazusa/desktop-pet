// make-icon.js · 应用图标生成：渲染桌宠同款 emoji 🐱 并截图为透明 PNG（assets/icon.png）
// 运行：npx electron scripts/make-icon.js
// 原理：Chromium 用 Segoe UI Emoji（彩色 COLR 字体）渲染 emoji，与桌宠显示完全一致；
//       透明窗口 capturePage 保留 alpha 通道，得到 512×512 透明背景图标。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1'); // 与主程序一致：物理像素

const SIZE = 512;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      offscreen: false // 隐藏窗口 + capturePage：renderer 默认保持 active，可捕获透明背景帧
    }
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; overflow: hidden; }
    .cat {
      width: ${SIZE}px; height: ${SIZE}px;
      display: flex; align-items: center; justify-content: center;
      font-size: ${Math.round(SIZE * 0.9)}px; line-height: 1;
    }
  </style></head><body><div class="cat">🐱</div></body></html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800)); // 等待 emoji 彩色字体渲染完成
  const image = await win.webContents.capturePage();

  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  const size = image.getSize();
  if (size.width === 0) {
    console.error('图标生成失败：捕获图像为空');
    app.exit(1);
  }
  console.log('图标已生成：' + out + '（' + size.width + '×' + size.height + '）');
  app.exit(0);
});
