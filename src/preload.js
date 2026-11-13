const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // true = 鼠标穿透到桌面;false = 窗口接收点击(鼠标在猫身上时)
  setClickThrough: (through) => ipcRenderer.send('click-through', through),
  // 外观档案:读取、保存,以及保存后通知桌宠窗口换装
  getLook: () => ipcRenderer.invoke('look:get'),
  saveLook: (look) => ipcRenderer.invoke('look:save', look),
  onLookChanged: (cb) => ipcRenderer.on('look:changed', (_e, look) => cb(look)),
  // 仅自检用:返回一张测试图片的 data URL
  getTestImage: () => ipcRenderer.invoke('test-image'),
  getDebugYaw: () => ipcRenderer.invoke('debug-yaw'),
  getDebug: () => ipcRenderer.invoke('debug'),
  reportSize: (size) => ipcRenderer.send('size-report', size),
  setWandHeld: (held) => ipcRenderer.send('wand-held', held),
  // 猫爬架的配置:读取、保存,以及保存后通知桌宠窗口换架子
  getTrees: () => ipcRenderer.invoke('trees:get'),
  saveTrees: (library) => ipcRenderer.invoke('trees:save', library),
  onTreesChanged: (cb) => ipcRenderer.on('trees:changed', (_e, library) => cb(library)),
  // 托盘菜单发来的指令:喂食、加水、逗猫棒、哈气等
  onCommand: (cb) => ipcRenderer.on('command', (_e, command, value) => cb(command, value)),
});
