import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { receiveLotteryResult } from "./controllers/lottery-results-controller.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { router } from "./routes/index.js";
import { asyncHandler } from "./utils/async-handler.js";
import { env } from "./utils/env.js";

export const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, "").toLowerCase();
    const explicitlyAllowed = env.corsOrigins.some(
      (allowedOrigin) => allowedOrigin.toLowerCase() === normalized
    );
    let hostname = "";
    try {
      hostname = new URL(normalized).hostname;
    } catch {
      return callback(new Error("Origem CORS invalida"));
    }
    const tenantOrigin =
      hostname === env.rootDomain
      || hostname === `www.${env.rootDomain}`
      || hostname.endsWith(`.${env.rootDomain}`);
    const sslipDevelopmentOrigin =
      hostname.endsWith(".sslip.io")
      && (
        env.rootDomain.endsWith(".sslip.io")
        || env.corsOrigins.some((allowedOrigin) => {
          try {
            return new URL(allowedOrigin).hostname.endsWith(".sslip.io");
          } catch {
            return false;
          }
        })
      );
    const localDevelopment =
      process.env.NODE_ENV !== "production"
      && (hostname === "localhost" || hostname === "127.0.0.1");
    if (!explicitlyAllowed && !tenantOrigin && !sslipDevelopmentOrigin && !localDevelopment) {
      return callback(new Error("Origem CORS nao permitida"));
    }
    return callback(null, true);
  },
  credentials: true
}));
app.post(
  "/api/integrations/lottery-results",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
  }),
  express.raw({ type: "application/json", limit: "128kb" }),
  asyncHandler(receiveLotteryResult)
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3000,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", router);
app.use(errorHandler);
