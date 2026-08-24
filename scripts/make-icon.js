// make-icon.js · 应用图标生成：将指定桌宠动作帧适配为透明 PNG（assets/icon.png）
// 运行：npx electron scripts/make-icon.js
// 原理：把动作帧等比放入透明方形画布，保留角色全身与 alpha 通道，输出 512×512 图标源图。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1'); // 与主程序一致：物理像素

const SIZE = 512;
const ART_SIZE = 456;
const source = path.join(__dirname, '..', 'assets', 'pet-actions', 'action-04', 'frame-03.png');

app.whenReady().then(async () => {
  if (!fs.existsSync(source)) {
    console.error('图标源图不存在：' + source);
    app.exit(1);
    return;
  }

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

  const sourceData = fs.readFileSync(source).toString('base64');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; overflow: hidden; }
    .icon {
      width: ${SIZE}px; height: ${SIZE}px;
      display: flex; align-items: center; justify-content: center;
    }
    img { width: ${ART_SIZE}px; height: ${ART_SIZE}px; object-fit: contain; }
  </style></head><body><div class="icon"><img src="data:image/png;base64,${sourceData}"></div></body></html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 200)); // 等待图片解码与首帧绘制完成
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
