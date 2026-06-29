import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hubPrinter", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config: unknown) => ipcRenderer.invoke("save-config", config),
  listPrinters: () => ipcRenderer.invoke("list-printers"),
  testPrint: () => ipcRenderer.invoke("test-print"),
  pollNow: () => ipcRenderer.invoke("poll-now"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  }
});
