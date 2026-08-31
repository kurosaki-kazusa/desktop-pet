'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'scripts', 'dist-temp.ps1'), 'utf8');
const css = fs.readFileSync(path.join(root, 'workspace.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(root, 'workspace.js'), 'utf8');

assert.equal(pkg.version, '3.0.0', 'P3 正式包版本应为 3.0.0');
assert.equal(pkg.build.asar, true, '正式包必须启用 asar');
['workspace.html', 'workspace.css', 'workspace.js', 'task-rules.js', 'main/**/*'].forEach((file) => {
  assert(pkg.build.files.includes(file), `打包白名单缺少 ${file}`);
});
['.env', 'config.json', '开发日志/开发日志.md'].forEach((file) => {
  assert(!pkg.build.files.includes(file), `敏感或开发文件不得进入打包白名单：${file}`);
});
assert(/if \(\$bad\)[\s\S]*?exit 1/.test(script), 'asar 白名单异常必须阻断打包');
assert(script.includes("'workspace.html'"), '纯净校验白名单缺少工作台入口');
assert(script.includes("($_ -ne 'main')") && script.includes("($_ -notlike 'main\\*')"), 'main 目录及模块应从顶层白名单核查中正确排除');
assert(script.includes('工作台「设置 / 大模型配置」'), '.env.example 应指向正式工作台设置页');
assert(css.includes('@media (max-width: 1500px)'), '缺少 1440×900 默认窗口布局适配');
assert(css.includes('overflow: hidden'), '根视口应固定，页面内容使用内部滚动');
assert(/space-form['"]\)\.addEventListener\('submit'[\s\S]*?submitter\.value === 'cancel'[\s\S]*?preventDefault/.test(workspaceJs), '空间弹窗取消操作必须在 preventDefault 前放行');

console.log('  ✓ 3.0.0 / asar / 工作台文件白名单正确');
console.log('  ✓ .env、用户配置与开发日志不进入安装包');
console.log('  ✓ asar 多余文件会阻断打包，1440×900 布局适配存在');
console.log('  ✓ 空间弹窗取消/关闭不受保存校验拦截');
console.log('\n全部通过：4 项');
