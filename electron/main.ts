import { app, BrowserWindow, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import { createReqoraServer } from '../server/index.ts';

const server = createReqoraServer({ staticDirectory: fileURLToPath(new URL('../../dist', import.meta.url)) });
let appUrl = '';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Reqora',
    backgroundColor: '#ffffff',
    icon: fileURLToPath(new URL('../../assets/logo-full.png', import.meta.url)),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appUrl) event.preventDefault();
  });

  void window
    .loadURL(appUrl)
    .catch((error: unknown) => {
      console.error('Unable to load the Reqora UI:', error);
      app.quit();
    });
}

async function startApp(): Promise<void> {
  Menu.setApplicationMenu(null);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // A stable origin keeps the desktop workspace available across launches.
    server.listen(43129, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start the local request engine.');
  appUrl = `http://127.0.0.1:${address.port}`;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void app.whenReady().then(startApp).catch((error: unknown) => {
    console.error('Unable to start Reqora:', error);
    app.quit();
  });
} else {
  app.quit();
}

app.on('before-quit', () => { if (server.listening) { server.closeAllConnections(); server.close(); } });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
