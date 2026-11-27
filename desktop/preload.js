// Most między stroną Cargo a komputerem. Strona widzi tylko te funkcje – nic więcej z dysku.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('gdsDesktop', {
  isDesktop: true,
  getSettings: () => call('cpp:getSettings'),
  setSettings: (o) => call('cpp:setSettings', o),
  pickFolder: (kind) => call('cpp:pickFolder', kind),
  listFolder: () => call('cpp:listFolder'),
  readFile: (p) => call('cpp:readFile', p),
  savePdf: (name) => call('cpp:savePdf', name),
  openPath: (p) => call('cpp:openPath', p),
  nightlyDone: (info) => call('cpp:nightlyDone', info),
  runNow: () => call('cpp:runNow'),
  notify: (t, b) => call('cpp:notify', t, b),
  onFolder: (cb) => { const f = (e, files) => cb(files); ipcRenderer.on('cpp:folder', f); return () => ipcRenderer.removeListener('cpp:folder', f) },
  onNightly: (cb) => { const f = (e, o) => cb(o); ipcRenderer.on('cpp:nightly', f); return () => ipcRenderer.removeListener('cpp:nightly', f) }
});
