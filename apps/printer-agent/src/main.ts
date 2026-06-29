import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from "electron";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

type Config = {
  apiUrl: string;
  token: string;
  printerName: string;
  autoPrint: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  pollIntervalSeconds: number;
};

type AgentOrder = {
  id: string;
  code: string;
  createdAt: string;
  total: number;
  customer: { name: string; phone: string };
  receipt: string;
};

const defaultConfig: Config = {
  apiUrl: "https://hubregional.com.br/api",
  token: "",
  printerName: "",
  autoPrint: true,
  startWithWindows: false,
  minimizeToTray: true,
  pollIntervalSeconds: 5
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pollingTimer: NodeJS.Timeout | null = null;
let connected = false;
let lastError = "";
let printing = false;
let isQuitting = false;
const logs: string[] = [];
const inMemoryPrinted = new Set<string>();

function dataFile() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): Config {
  try {
    const file = dataFile();
    if (!existsSync(file)) return defaultConfig;
    return { ...defaultConfig, ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: Config) {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) {
    // sync is fine here during explicit user save.
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dataFile(), JSON.stringify(config, null, 2), "utf8");
  app.setLoginItemSettings({ openAtLogin: config.startWithWindows });
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function addLog(message: string) {
  const line = `${new Date().toLocaleString("pt-BR")} - ${message}`;
  logs.unshift(line);
  logs.splice(80);
  sendState();
}

function sendState() {
  mainWindow?.webContents.send("state", {
    connected,
    lastError,
    logs,
    config: readConfig()
  });
}

async function listPrinters() {
  if (process.platform !== "win32") return [];
  const script = [
    "$names = @()",
    "try { $names += Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name } catch {}",
    "try {",
    "  $devices = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices' -ErrorAction Stop",
    "  $names += $devices.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | Select-Object -ExpandProperty Name",
    "} catch {}",
    "try { $names += Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers' -ErrorAction Stop | Select-Object -ExpandProperty PSChildName } catch {}",
    "$names | Where-Object { $_ } | Sort-Object -Unique | ConvertTo-Json -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const output = stdout.trim();
  if (!output) return [];
  const parsed = JSON.parse(output) as string | string[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function printText(printerName: string, text: string) {
  if (process.platform !== "win32") {
    throw new Error("Este agente de impressao foi feito para Windows.");
  }
  if (!printerName.trim()) throw new Error("Selecione uma impressora.");

  const filePath = path.join(tmpdir(), `hubregional-print-${crypto.randomUUID()}.txt`);
  await writeFile(filePath, text, "utf8");
  try {
    const script = [
      "$file = $env:HUB_PRINT_FILE",
      "$printer = $env:HUB_PRINT_PRINTER",
      "Get-Content -LiteralPath $file -Raw -Encoding UTF8 | Out-Printer -Name $printer"
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, HUB_PRINT_FILE: filePath, HUB_PRINT_PRINTER: printerName }
    });
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

async function apiRequest<T>(pathName: string, options: RequestInit = {}): Promise<T> {
  const config = readConfig();
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const response = await fetch(`${apiUrl}${pathName}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? `Erro HTTP ${response.status}`);
  return payload as T;
}

async function markPrinted(orderId: string, ok: boolean, error?: string) {
  await apiRequest(`/printer-agent/orders/${orderId}/printed`, {
    method: "POST",
    body: JSON.stringify({ ok, error })
  });
}

async function handleOrder(order: AgentOrder) {
  const config = readConfig();
  if (!config.autoPrint || inMemoryPrinted.has(order.id)) return;
  inMemoryPrinted.add(order.id);

  try {
    await printText(config.printerName, order.receipt);
    await markPrinted(order.id, true);
    addLog(`Pedido #${order.code} impresso para ${order.customer.name}`);
  } catch (error) {
    inMemoryPrinted.delete(order.id);
    const message = error instanceof Error ? error.message : "Falha desconhecida";
    await markPrinted(order.id, false, message).catch(() => undefined);
    addLog(`Erro ao imprimir pedido #${order.code}: ${message}`);
  }
}

async function pollOrders() {
  if (printing) return;
  const config = readConfig();
  if (!config.token || !config.apiUrl) {
    connected = false;
    lastError = "Informe URL da API e token.";
    sendState();
    return;
  }

  printing = true;
  try {
    const payload = await apiRequest<{ orders: AgentOrder[] }>("/printer-agent/orders");
    connected = true;
    lastError = "";
    for (const order of payload.orders) {
      await handleOrder(order);
    }
  } catch (error) {
    connected = false;
    lastError = error instanceof Error ? error.message : "Erro de conexao";
  } finally {
    printing = false;
    sendState();
  }
}

function restartPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  const config = readConfig();
  pollingTimer = setInterval(() => void pollOrders(), Math.max(3, config.pollIntervalSeconds) * 1000);
  void pollOrders();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    title: "HubRegional Printer Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("close", (event) => {
    if (readConfig().minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("HubRegional Printer Agent");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir", click: () => mainWindow?.show() },
    { label: "Verificar pedidos agora", click: () => void pollOrders() },
    { type: "separator" },
    { label: "Sair", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => mainWindow?.show());
}

ipcMain.handle("get-config", () => ({ config: readConfig(), connected, lastError, logs }));
ipcMain.handle("save-config", (_event, config: Config) => {
  saveConfig({ ...defaultConfig, ...config, apiUrl: normalizeApiUrl(config.apiUrl) });
  restartPolling();
  return { ok: true };
});
ipcMain.handle("list-printers", async () => listPrinters());
ipcMain.handle("test-print", async () => {
  const config = readConfig();
  const payload = config.token
    ? await apiRequest<{ receipt: string }>("/printer-agent/test").catch(() => null)
    : null;
  await printText(config.printerName, payload?.receipt ?? "HUBREGIONAL\r\nTESTE DE IMPRESSAO\r\n\r\n");
  addLog("Teste de impressao enviado");
  return { ok: true };
});
ipcMain.handle("poll-now", async () => {
  await pollOrders();
  return { ok: true };
});
ipcMain.handle("open-external", (_event, url: string) => shell.openExternal(url));

app.whenReady().then(async () => {
  await mkdir(app.getPath("userData"), { recursive: true });
  createWindow();
  createTray();
  restartPolling();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Mantem o agente rodando na bandeja.
  }
});
