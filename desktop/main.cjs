const { app: electronApp, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const OWNER_WATERMARK = 'dev-willbird1936';
let server;
let mainWindow;

async function createWindow() {
  Menu.setApplicationMenu(null);

  const serverModuleUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'src', 'server.js')).href;
  const { app: expressApp } = await import(serverModuleUrl);

  server = expressApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  mainWindow = new BrowserWindow({
    width: 540,
    height: 920,
    minWidth: 520,
    minHeight: 720,
    title: `Character Normalizer - ${OWNER_WATERMARK}`,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    if (process.env.CHARACTER_NORMALIZER_SMOKE === '1') {
      console.log(`desktop-smoke-ok ${OWNER_WATERMARK}`);
      setTimeout(() => electronApp.quit(), 1200);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

ipcMain.handle('character-normalizer:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return '';
  }

  return result.filePaths[0];
});

electronApp.whenReady().then(createWindow);

electronApp.on('window-all-closed', () => {
  electronApp.quit();
});

electronApp.on('before-quit', () => {
  if (server) {
    server.close();
    server = undefined;
  }
});
