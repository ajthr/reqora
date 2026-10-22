import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Reqora',
    backgroundColor: '#ffffff',
    icon: fileURLToPath(new URL('../assets/logo-full.png', import.meta.url)),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  void window
    .loadFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)))
    .catch((error: unknown) => {
      console.error('Unable to load the Reqora UI:', error);
      app.quit();
    });
}

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
