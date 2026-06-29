import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");
mkdirSync(join(app, "dist", "renderer"), { recursive: true });
copyFileSync(join(app, "src", "renderer", "index.html"), join(app, "dist", "renderer", "index.html"));
