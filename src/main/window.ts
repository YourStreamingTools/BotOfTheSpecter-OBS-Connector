import { BrowserWindow, shell } from 'electron';
import { join } from 'path';
import iconPath from '../../resources/icon.png?asset';

// Re-exported so the main entrypoint can pass the same path to app.dock.setIcon() on macOS.
export const APP_ICON_PATH = iconPath;

/** Only http(s) URLs may leave the app via openExternal. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0D0D0D',
    show: false,
    // Sets the Windows + Linux taskbar/window icon; macOS dock icon is set separately in main/index.ts.
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // External links open in the OS browser, never in-app. Only http(s) — deny file:, custom protocols, etc.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Defense-in-depth: never navigate the app shell away from the packed renderer / dev server.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) ||
      url.startsWith('file:');
    if (!allowed) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
