import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { downloadArtifact } from "@electron/get";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = join(root, "apps", "printer-agent");
const output = join(source, "release", "HubRegional Printer Agent");
const appDir = join(output, "resources", "app");

rmSync(output, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

const zipPath = await downloadArtifact({
  version: "31.7.7",
  artifactName: "electron",
  platform: "win32",
  arch: "x64"
});

const sevenZip = join(root, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
execFileSync(sevenZip, ["x", "-y", zipPath, `-o${output}`], { stdio: "inherit" });

const originalExe = join(output, "electron.exe");
const finalExe = join(output, "HubRegional Printer Agent.exe");
if (existsSync(originalExe)) {
  renameSync(originalExe, finalExe);
}

cpSync(join(source, "dist"), join(appDir, "dist"), { recursive: true });
writeFileSync(join(appDir, "package.json"), JSON.stringify({
  name: "hubregional-printer-agent",
  version: "1.0.0",
  main: "dist/main.js"
}, null, 2), "utf8");

writeFileSync(join(output, "COMO-USAR.txt"), [
  "HubRegional Printer Agent",
  "",
  "1. Execute: HubRegional Printer Agent.exe",
  "2. Informe a URL da API: https://hubregional.com.br/api",
  "3. Cole o token gerado no painel admin da loja.",
  "4. Clique em Buscar impressoras e selecione a impressora.",
  "5. Clique em Testar impressao.",
  "6. Deixe Impressao automatica ativada.",
  "",
  "Para criar atalho, clique com o botao direito no .exe e envie para a area de trabalho."
].join("\r\n"), "utf8");

if (!existsSync(finalExe)) {
  throw new Error("Executavel nao foi gerado");
}

console.log(`Aplicativo gerado em: ${finalExe}`);
