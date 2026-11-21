/* One Verse Evangelism — Electron shell.
   Purpose is presentation reliability: offline, fullscreen, no browser chrome,
   no sleep mid-session, and no accidental navigation away from the deck. */

const { app, BrowserWindow, Menu, powerSaveBlocker, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const LESSON   = process.env.OVE_LESSON || 'lesson1';  // lesson1 | lesson2
const DEBUG    = process.env.OVE_DEBUG === '1';       // windowed + live reload + CDP
const DEVTOOLS = process.env.OVE_DEVTOOLS === '1';    // opt in separately — noisy

/* Agent-driving over CDP, for development only. The switch has to be
   appended synchronously at module scope, before Chromium initialises. */
const CDP_PORT = app.isPackaged ? null : Number(process.env.MC_CDP_PORT) || 9444;
if (CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));

let win = null;
let saveBlockerId = null;

const isFullScreen = () =>
  process.platform === 'darwin' ? win.isSimpleFullScreen() : win.isFullScreen();
const setFullScreen = on =>
  process.platform === 'darwin' ? win.setSimpleFullScreen(on) : win.setFullScreen(on);

async function boot() {
  await app.whenReady();
  createWindow();

  if (CDP_PORT) console.log(`[cdp] remote debugging on ${CDP_PORT}`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0b1220',      // matches the navy stage, so there is no white flash
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // the deck is fully static and local; nothing needs a preload bridge
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required'   // the video starts on its screen
    }
  });

  win.loadFile(path.join(__dirname, '..', 'app', `${LESSON}.html`));

  win.once('ready-to-show', () => {
    win.show();
    if (DEBUG) {
      if (DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
    } else {
      // macOS: simple fullscreen covers the screen immediately. Native
      // fullscreen animates into its own Space and, from a show:false window,
      // is unreliable — both the constructor option and setFullScreen() get
      // dropped. Simple fullscreen also avoids the Space-switch on launch,
      // which is what you want walking into a room.
      if (process.platform === 'darwin') win.setSimpleFullScreen(true);
      else win.setFullScreen(true);
    }
    console.log('[window] shown, fullscreen =', DEBUG ? false : isFullScreen());
  });

  // Never let a stray link navigate away from the presentation.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  win.on('closed', () => { win = null; });

  if (DEBUG) watchForChanges();
}

/* Live reload while iterating: the deck is plain files, so a save is all the
   feedback loop should need. Packaged builds never reach this — DEBUG is off
   and the app bundle is read-only anyway. */
function watchForChanges(){
  const dir = path.join(__dirname, '..', 'app');
  let timer = null;
  try {
    fs.watch(dir, { recursive: true }, (_evt, file) => {
      if (file && !/\.(html|css|js)$/.test(file)) return;
      clearTimeout(timer);                       // editors fire several events per save
      timer = setTimeout(() => {
        if (!win) return;
        console.log('[dev] reloading —', file);
        win.reload();
      }, 120);
    });
    console.log('[dev] watching', dir, '— saves reload the window');
  } catch (e) {
    console.warn('[dev] file watch unavailable:', e.message);
  }
}

/* A real menu, not null.

   Setting the application menu to null on macOS takes Cmd+Q with it, which
   leaves someone who double-clicked the app stuck in fullscreen with no way
   out but Force Quit. The menu bar is hidden while fullscreen anyway, so it
   costs the presentation nothing and is there when it is needed.

   These are menu accelerators rather than globalShortcut on purpose:
   globalShortcut is system-wide and would take Cmd+R away from every other
   app for as long as this one is open. */
function buildMenu(){
  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Toggle Full Screen',
        accelerator: process.platform === 'darwin' ? 'Control+Command+F' : 'F11',
        click: () => win && setFullScreen(!isFullScreen()),
      },
      {
        label: 'Reload',                       // if something wedges mid-class
        accelerator: 'CommandOrControl+R',
        click: () => win && win.reload(),
      },
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();

  // Keep the screen awake for the length of a session.
  saveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
});

app.on('will-quit', () => {
  if (saveBlockerId !== null && powerSaveBlocker.isStarted(saveBlockerId)) {
    powerSaveBlocker.stop(saveBlockerId);
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

boot();
