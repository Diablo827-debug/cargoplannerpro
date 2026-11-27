// Cargo Planner Pro – wersja na komputer (Windows)
// Okno ładuje cargo.grudka-studio.dev (zawsze aktualna wersja), a program dokłada to,
// czego przeglądarka nie potrafi: obserwowanie folderu z zamówieniami, nocne liczenie,
// zapis PDF do folderu, ikonę przy zegarku i autostart.
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'https://cargo.grudka-studio.dev';
const START_URL = process.env.CPP_URL || ORIGIN + '/';
const ALLOWED = [new URL(START_URL).origin, ORIGIN];
const EXT = /\.(xls|xlsx|xlsm|csv)$/i;

let win = null, tray = null, quitting = false;
const hidden = process.argv.includes('--hidden');

// ---------- ustawienia ----------
const SET_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEF = { folder: '', recursive: true, nightlyOn: false, time: '20:00', daysAhead: 7, autoPrint: false, printerLabels: '', printerA4: '', pdfFolder: '', autostart: false, lastRunDay: '', lastRun: null, hideOnClose: true };
let S = { ...DEF };
function loadSet() { try { S = { ...DEF, ...JSON.parse(fs.readFileSync(SET_FILE(), 'utf8')) } } catch (e) { S = { ...DEF } } }
function saveSet() { try { fs.mkdirSync(path.dirname(SET_FILE()), { recursive: true }); fs.writeFileSync(SET_FILE(), JSON.stringify(S, null, 2)) } catch (e) { console.error(e) } }
function applyAutostart() { try { app.setLoginItemSettings({ openAtLogin: !!S.autostart, args: ['--hidden'] }) } catch (e) { } }

// tylko strona Cargo może wołać funkcje komputera
const okSender = e => { try { return ALLOWED.includes(new URL(e.senderFrame.url).origin) } catch (x) { return false } };
const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { if (!okSender(e)) throw new Error('forbidden'); return fn(...a) });

// ---------- folder z zamówieniami ----------
function listFolder(dir, recursive, depth = 0, out = []) {
  if (!dir) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return out }
  for (const d of ents) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (recursive && depth < 3 && !d.name.startsWith('.')) listFolder(p, recursive, depth + 1, out); continue }
    if (!EXT.test(d.name) || d.name.startsWith('~$')) continue;
    try { const st = fs.statSync(p); out.push({ path: p, name: d.name, size: st.size, mtime: st.mtimeMs }) } catch (e) { }
  }
  return out;
}
const insideFolder = p => { if (!S.folder) return false; const rel = path.relative(path.resolve(S.folder), path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) };

let lastSig = '';
function pollFolder() {
  if (!S.folder || !win) return;
  const files = listFolder(S.folder, S.recursive);
  const sig = files.map(f => f.path + ':' + f.mtime).sort().join('|');
  if (sig !== lastSig) { lastSig = sig; win.webContents.send('cpp:folder', files) }
}

// ---------- nocne liczenie ----------
const dayKey = d => d.toISOString().slice(0, 10);
let nightlyBusy = false;
function checkSchedule() {
  if (!S.nightlyOn || !win || nightlyBusy) return;
  const now = new Date(), [h, m] = String(S.time || '20:00').split(':').map(Number);
  const due = new Date(now); due.setHours(h || 0, m || 0, 0, 0);
  const today = dayKey(new Date(now.getTime() - now.getTimezoneOffset() * 60000));
  if (now >= due && S.lastRunDay !== today) { S.lastRunDay = today; saveSet(); runNightly('harmonogram') }
  // komputer był wyłączony o tej godzinie wczoraj → nadrób przy starcie (żeby rano były gotowe palety)
  else if (now < due && S.lastRunDay && S.lastRunDay < dayKey(new Date(now.getTime() - 86400000 - now.getTimezoneOffset() * 60000))) { S.lastRunDay = dayKey(new Date(now.getTime() - 86400000 - now.getTimezoneOffset() * 60000)); saveSet(); runNightly('nadrobienie') }
}
function runNightly(why) {
  if (!win) return;
  nightlyBusy = true;
  win.webContents.send('cpp:nightly', { why, daysAhead: S.daysAhead || 2 });
  setTimeout(() => { nightlyBusy = false }, 30 * 60 * 1000);
}

// ---------- okno ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, show: !hidden,
    title: 'Cargo Planner Pro', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false }
  });
  win.loadURL(START_URL);
  // linki do innych stron → zwykła przeglądarka; logowanie Firebase zostaje w oknie
  const inApp = u => { try { const o = new URL(u).origin; return ALLOWED.includes(o) || /firebaseapp\.com$|googleapis\.com$|accounts\.google\.com$/.test(new URL(u).hostname) } catch (e) { return false } };
  win.webContents.setWindowOpenHandler(({ url }) => { if (inApp(url)) return { action: 'allow' }; shell.openExternal(url); return { action: 'deny' } });
  win.webContents.on('will-navigate', (e, url) => { if (!inApp(url)) { e.preventDefault(); shell.openExternal(url) } });
  win.on('close', e => {
    if (!quitting && S.hideOnClose && tray) {
      e.preventDefault(); win.hide();
      if (!S._hintShown) { S._hintShown = true; saveSet(); notify('Cargo Planner działa dalej', 'Program jest przy zegarku (prawy dolny róg) i policzy palety o ' + (S.time || '20:00') + '. Aby zamknąć: prawy klik na ikonie → Zamknij.') }
    }
  });
  win.webContents.on('did-finish-load', () => { lastSig = ''; setTimeout(pollFolder, 1500) });
}
function show() { if (!win) createWindow(); win.show(); if (win.isMinimized()) win.restore(); win.focus() }
function notify(title, body) { try { if (Notification.isSupported()) { const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') }); n.on('click', show); n.show() } } catch (e) { } }

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Cargo Planner Pro');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Otwórz Cargo Planner', click: show },
    { label: 'Policz palety teraz (jak w nocy)', click: () => { show(); runNightly('ręcznie') } },
    { type: 'separator' },
    { label: 'Uruchamiaj z Windows', type: 'checkbox', checked: !!S.autostart, click: i => { S.autostart = i.checked; saveSet(); applyAutostart() } },
    { type: 'separator' },
    { label: 'Zamknij', click: () => { quitting = true; app.quit() } }
  ]);
  tray.setContextMenu(menu());
  tray.on('click', show);
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

// ---------- funkcje dla strony ----------
handle('cpp:getSettings', () => ({ ...S, version: app.getVersion() }));
handle('cpp:setSettings', (o) => {
  const keys = ['recursive', 'nightlyOn', 'time', 'daysAhead', 'autostart', 'hideOnClose', 'autoPrint', 'printerLabels', 'printerA4'];
  for (const k of keys) if (o && k in o) S[k] = o[k];
  if (o && 'time' in o && /^\d{1,2}:\d{2}$/.test(o.time)) { const now = new Date(), [h, m] = o.time.split(':').map(Number), d = new Date(now); d.setHours(h, m, 0, 0); if (d > now) S.lastRunDay = '' }
  saveSet(); applyAutostart(); lastSig = ''; pollFolder(); return { ...S };
});
handle('cpp:pickFolder', async (kind) => {
  const r = await dialog.showOpenDialog(win, { title: kind === 'pdf' ? 'Folder na gotowe wydruki PDF' : 'Folder z zamówieniami (pliki Excel z Mebway)', properties: ['openDirectory'], defaultPath: (kind === 'pdf' ? S.pdfFolder : S.folder) || undefined });
  if (r.canceled || !r.filePaths[0]) return null;
  if (kind === 'pdf') S.pdfFolder = r.filePaths[0]; else S.folder = r.filePaths[0];
  saveSet(); lastSig = ''; pollFolder(); return r.filePaths[0];
});
handle('cpp:listFolder', () => listFolder(S.folder, S.recursive));
handle('cpp:readFile', (p) => { if (!insideFolder(p) || !EXT.test(p)) throw new Error('Plik spoza folderu zamówień'); const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
handle('cpp:savePdf', async (name) => {
  if (!S.pdfFolder) return null;
  const safe = String(name || 'Cargo').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
  fs.mkdirSync(S.pdfFolder, { recursive: true });
  const p = path.join(S.pdfFolder, safe.endsWith('.pdf') ? safe : safe + '.pdf');
  fs.writeFileSync(p, data); return p;
});
handle('cpp:printers', async () => { try { return (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault })) } catch (e) { return [] } });
// druk bez okienka: etykiety → drukarka termiczna, ułożenie palet → drukarka A4
handle('cpp:printSilent', (kind) => new Promise(res => {
  const deviceName = kind === 'labels' ? S.printerLabels : S.printerA4;
  const opt = { silent: true, printBackground: true, margins: { marginType: 'none' } };
  if (deviceName) opt.deviceName = deviceName;
  // zawsze dokładnie rozmiar strony: etykieta 100×150 mm w pionie albo A4 – treść dopasowana, bez skalowania sterownika
  if (kind === 'labels') { opt.pageSize = { width: 100000, height: 150000 }; opt.landscape = false } else opt.pageSize = 'A4';
  opt.scaleFactor = 100;
  try { win.webContents.print(opt, (ok, err) => res({ ok, err: err || '' , printer: deviceName || '(domyślna)' })) } catch (e) { res({ ok: false, err: String(e) }) }
}));
handle('cpp:openPath', (p) => { if (p && (insideFolder(p) || (S.pdfFolder && path.resolve(p).startsWith(path.resolve(S.pdfFolder))))) shell.openPath(p) });
handle('cpp:nightlyDone', (info) => {
  nightlyBusy = false; S.lastRun = { at: Date.now(), ...(info || {}) }; saveSet();
  if (info && info.msg) notify('Cargo Planner – palety policzone', info.msg);
  return true;
});
handle('cpp:runNow', () => { runNightly('ręcznie'); return true });
handle('cpp:notify', (t, b) => notify(String(t || ''), String(b || '')));

// ---------- start ----------
if (!app.requestSingleInstanceLock()) { app.quit() } else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    app.setAppUserModelId('dev.grudka-studio.cargo');
    loadSet(); applyAutostart(); createWindow(); createTray();
    setInterval(pollFolder, 60 * 1000);
    setInterval(checkSchedule, 30 * 1000);
    setTimeout(checkSchedule, 20 * 1000);
  });
  app.on('before-quit', () => { quitting = true });
  app.on('window-all-closed', () => { if (!tray) app.quit() });
}
