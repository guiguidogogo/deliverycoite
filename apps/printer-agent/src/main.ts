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
  printCopies: number;
  paperWidth: 58 | 80;
  printMode: "windows" | "raw-text" | "raw-escpos";
  printFromNowAt?: string;
};

type AgentOrder = {
  id: string;
  type?: string;
  title?: string;
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
  pollIntervalSeconds: 5,
  printCopies: 1,
  paperWidth: 58,
  printMode: "windows",
  printFromNowAt: ""
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
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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

function sanitizeThermalText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function plainTextBuffer(text: string) {
  const clean = sanitizeThermalText(text).replace(/\r?\n/g, "\r\n");
  return Buffer.from(`${clean}\r\n\r\n\r\n`, "ascii");
}

function escPosBuffer(text: string) {
  const clean = sanitizeThermalText(text).replace(/\r?\n/g, "\r\n");
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]), // ESC @ - init
    Buffer.from([0x1b, 0x74, 0x02]), // CP850 when supported
    Buffer.from(clean, "ascii"),
    Buffer.from("\r\n\r\n\r\n", "ascii"),
    Buffer.from([0x1d, 0x56, 0x42, 0x00]) // partial cut, ignored by printers without cutter
  ]);
}

async function printWithWindowsDriver(printerName: string, text: string) {
  const filePath = path.join(tmpdir(), `hubregional-print-${crypto.randomUUID()}.txt`);
  await writeFile(filePath, sanitizeThermalText(text), "utf8");
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

async function printRaw(printerName: string, text: string, mode: "raw-text" | "raw-escpos") {
  const filePath = path.join(tmpdir(), `hubregional-print-${crypto.randomUUID()}.bin`);
  await writeFile(filePath, mode === "raw-escpos" ? escPosBuffer(text) : plainTextBuffer(text));
  try {
    const script = [
      "$file = $env:HUB_PRINT_FILE",
      "$printer = $env:HUB_PRINT_PRINTER",
      `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);
}
'@`,
      "$bytes = [System.IO.File]::ReadAllBytes($file)",
      "$handle = [IntPtr]::Zero",
      "if (-not [RawPrinterHelper]::OpenPrinter($printer, [ref]$handle, [IntPtr]::Zero)) { throw 'Nao foi possivel abrir a impressora RAW' }",
      "$doc = New-Object RawPrinterHelper+DOCINFOA",
      "$doc.pDocName = 'HubRegional Pedido'",
      "$doc.pDataType = 'RAW'",
      "try {",
      "  [void][RawPrinterHelper]::StartDocPrinter($handle, 1, $doc)",
      "  [void][RawPrinterHelper]::StartPagePrinter($handle)",
      "  $written = 0",
      "  if (-not [RawPrinterHelper]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) { throw 'Falha ao enviar bytes para impressora' }",
      "  [void][RawPrinterHelper]::EndPagePrinter($handle)",
      "  [void][RawPrinterHelper]::EndDocPrinter($handle)",
      "} finally { [void][RawPrinterHelper]::ClosePrinter($handle) }"
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, HUB_PRINT_FILE: filePath, HUB_PRINT_PRINTER: printerName }
    });
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

async function printText(printerName: string, text: string, mode: Config["printMode"]) {
  if (process.platform !== "win32") {
    throw new Error("Este agente de impressao foi feito para Windows.");
  }
  if (!printerName.trim()) throw new Error("Selecione uma impressora.");

  if (mode === "raw-escpos" || mode === "raw-text") return printRaw(printerName, text, mode);
  return printWithWindowsDriver(printerName, text);
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
    const copies = Math.min(5, Math.max(1, Number(config.printCopies || 1)));
    for (let copy = 0; copy < copies; copy += 1) {
      await printText(config.printerName, order.receipt, config.printMode || "windows");
    }
    await markPrinted(order.id, true);
    const label = order.type && order.type !== "ORDER" ? (order.title ?? order.code) : `Pedido #${order.code}`;
    addLog(`${label} impresso${order.type === "ORDER" ? ` para ${order.customer.name}` : ""} (${copies} via${copies > 1 ? "s" : ""})`);
  } catch (error) {
    inMemoryPrinted.delete(order.id);
    const message = error instanceof Error ? error.message : "Falha desconhecida";
    await markPrinted(order.id, false, message).catch(() => undefined);
    addLog(`Erro ao imprimir ${order.title ?? `pedido #${order.code}`}: ${message}`);
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
  if (config.autoPrint && !config.printerName.trim()) {
    connected = false;
    lastError = "Selecione e salve uma impressora principal antes de ativar a impressao automatica.";
    sendState();
    return;
  }

  printing = true;
  try {
    const search = new URLSearchParams({ paperWidth: String(config.paperWidth || 58) });
    if (config.printFromNowAt) search.set("since", config.printFromNowAt);
    const payload = await apiRequest<{ orders: AgentOrder[] }>(`/printer-agent/orders?${search.toString()}`);
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
  const current = readConfig();
  saveConfig({
    ...defaultConfig,
    ...config,
    apiUrl: normalizeApiUrl(config.apiUrl),
    printCopies: Math.min(5, Math.max(1, Number(config.printCopies || 1))),
    paperWidth: config.paperWidth === 80 ? 80 : 58,
    printMode: ["raw-text", "raw-escpos", "windows"].includes(config.printMode) ? config.printMode : "windows",
    printFromNowAt: config.printFromNowAt || current.printFromNowAt || new Date().toISOString()
  });
  restartPolling();
  sendState();
  return { ok: true, config: readConfig() };
});
ipcMain.handle("list-printers", async () => listPrinters());
ipcMain.handle("test-print", async () => {
  const config = readConfig();
  const payload = config.token
    ? await apiRequest<{ receipt: string }>(`/printer-agent/test?paperWidth=${config.paperWidth || 58}`).catch(() => null)
    : null;
  await printText(config.printerName, payload?.receipt ?? "HUBREGIONAL\r\nTESTE DE IMPRESSAO\r\n\r\n", config.printMode || "windows");
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
