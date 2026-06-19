import qz from "qz-tray";

type QzApi = {
  websocket: {
    isActive(): boolean;
    connect(options?: Record<string, unknown>): Promise<void>;
  };
  printers: {
    find(): Promise<string[]>;
  };
  configs: {
    create(printer: string, options?: Record<string, unknown>): unknown;
  };
  print(config: unknown, data: unknown[]): Promise<void>;
};

const qzApi = qz as unknown as QzApi;

export async function connectPrintAgent() {
  if (!qzApi.websocket.isActive()) {
    await qzApi.websocket.connect({ retries: 2, delay: 1 });
  }
}

export async function findLocalPrinters() {
  await connectPrintAgent();
  return qzApi.printers.find();
}

export async function printHtmlWithAgent(
  printerName: string,
  html: string,
  paperWidth: 58 | 80
) {
  if (!printerName.trim()) throw new Error("Selecione uma impressora");
  await connectPrintAgent();
  const config = qzApi.configs.create(printerName, {
    size: { width: paperWidth, height: null },
    units: "mm",
    margins: 0
  });
  await qzApi.print(config, [{
    type: "pixel",
    format: "html",
    flavor: "plain",
    data: html
  }]);
}

export function printAgentInstallUrl() {
  return "https://qz.io/download/";
}
