// Electron 主进程:一个覆盖工作区的透明置顶窗口(桌宠),外加一个普通窗口(外观工作室)。
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let studio = null;
let treeEditor = null;
let tray = null;

const preload = path.join(__dirname, 'preload.js');
const lookFile = () => path.join(app.getPath('userData'), 'cat-look.json');
const treeFile = () => path.join(app.getPath('userData'), 'cat-trees.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readLook() {
  try {
    return JSON.parse(fs.readFileSync(lookFile(), 'utf8'));
  } catch {
    return null;
  }
}

function snapshotThenQuit(target, file) {
  target.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const image = await target.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      app.quit();
    }, Number(process.env.CAT_SNAPSHOT_DELAY || 3000));
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 默认整窗穿透,但仍把鼠标移动转发给页面,由页面判断鼠标是否在猫身上。
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('console-message', (e) => console.log('[pet]', e.message));

  // 自检模式:渲染几秒后把窗口内容存成 PNG 然后退出。
  if (process.env.CAT_SNAPSHOT) snapshotThenQuit(win, process.env.CAT_SNAPSHOT);
}

function openStudio() {
  if (studio) {
    studio.show();
    studio.focus();
    return;
  }
  studio = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: '猫咪外观工作室',
    webPreferences: { preload, contextIsolation: true },
  });
  studio.loadFile(path.join(__dirname, 'studio', 'index.html'));
  studio.webContents.on('console-message', (e) => console.log('[studio]', e.message));
  studio.on('closed', () => (studio = null));
  if (process.env.CAT_STUDIO_SNAPSHOT) snapshotThenQuit(studio, process.env.CAT_STUDIO_SNAPSHOT);
}

function openTreeEditor() {
  if (treeEditor) {
    treeEditor.show();
    treeEditor.focus();
    return;
  }
  treeEditor = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: '定制猫爬架',
    webPreferences: { preload, contextIsolation: true },
  });
  treeEditor.loadFile(path.join(__dirname, 'tree', 'index.html'));
  treeEditor.webContents.on('console-message', (e) => console.log('[tree]', e.message));
  treeEditor.on('closed', () => (treeEditor = null));
  if (process.env.CAT_TREE_SNAPSHOT) snapshotThenQuit(treeEditor, process.env.CAT_TREE_SNAPSHOT);
}

const command = (name, value) => win && win.webContents.send('command', name, value);

let petSize = 0.75;
let wandHeld = false;
const SIZES = [['小', 0.6], ['中', 0.75], ['大', 1]];

function buildMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '加猫粮', click: () => command('feed') },
      { label: '加水', click: () => command('water') },
      { label: '逗猫棒(按 Esc 放回)', type: 'checkbox', checked: wandHeld, click: (item) => command('wand', item.checked) },
      { label: '让它哈气', click: () => command('hiss') },
      { type: 'separator' },
      { label: '猫爬架', type: 'checkbox', checked: true, click: (item) => command('tree', item.checked) },
      { label: '静音', type: 'checkbox', checked: false, click: (item) => command('mute', item.checked) },
      {
        label: '整体大小',
        submenu: SIZES.map(([label, value]) => ({
          label, type: 'radio', checked: Math.abs(value - petSize) < 0.01, click: () => command('size', value),
        })),
      },
      { label: '定制猫爬架…', click: openTreeEditor },
      { label: '定制外观…', click: openStudio },
      { label: '显示 / 隐藏', click: () => (win.isVisible() ? win.hide() : win.showInactive()) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🐱');
  buildMenu();
}

// 逗猫棒拿在手上时,Esc 是"放回座子";放回之后就把 Esc 还给其他程序
ipcMain.on('wand-held', (_e, held) => {
  wandHeld = Boolean(held);
  if (wandHeld) globalShortcut.register('Escape', () => command('wand', false));
  else globalShortcut.unregister('Escape');
  if (tray) buildMenu();
});
app.on('will-quit', () => globalShortcut.unregisterAll());

// 桌宠窗口启动时报告它实际用的大小,菜单里的选中项跟着更新
ipcMain.on('size-report', (_e, size) => {
  petSize = Number(size) || petSize;
  if (tray) buildMenu();
});

ipcMain.on('click-through', (e, through) => {
  if (win && e.sender === win.webContents) win.setIgnoreMouseEvents(Boolean(through), { forward: true });
});
ipcMain.handle('look:get', () => readLook());
ipcMain.handle('look:save', (_e, look) => {
  fs.writeFileSync(lookFile(), JSON.stringify(look, null, 2));
  if (win) win.webContents.send('look:changed', look);
});
ipcMain.handle('trees:get', () => readJson(treeFile()));
ipcMain.handle('trees:save', (_e, library) => {
  fs.writeFileSync(treeFile(), JSON.stringify(library, null, 2));
  if (win) win.webContents.send('trees:changed', library);
});
ipcMain.handle('debug-yaw', () => process.env.CAT_YAW || null);
ipcMain.handle('debug', () => process.env.CAT_DEBUG || null);
ipcMain.handle('test-image', () => {
  const file = process.env.CAT_TEST_IMAGE;
  if (!file) return null;
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
});

// 音效是猫自己发出来的,不是用户点击触发的,所以放开自动播放限制
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  createWindow();
  createTray();
  if (process.env.CAT_STUDIO_SNAPSHOT || process.argv.includes('--studio')) openStudio();
  if (process.env.CAT_TREE_SNAPSHOT || process.argv.includes('--tree')) openTreeEditor();
});

app.on('window-all-closed', () => app.quit());
