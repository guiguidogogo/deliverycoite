import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { errorHandler } from "./middlewares/error-handler.js";
import { router } from "./routes/index.js";
import { env } from "./utils/env.js";

export const app = express();

app.use(helmet());
app.use(cors({ 
  origin: true, // Permite todas as origens (necessário para ngrok)
  credentials: true 
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", router);
app.use(errorHandler);
