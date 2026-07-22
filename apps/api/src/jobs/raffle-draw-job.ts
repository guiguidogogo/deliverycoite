import { processDueAutomaticRaffles } from "../services/raffle-draw-service.js";
import { env } from "../utils/env.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startRaffleDrawJob() {
  if (env.lotteryCollectorWebhookEnabled) {
    console.log("[raffle-draw] consulta direta desativada; coletor externo ativo");
    return;
  }
  if (!env.raffleDrawJobEnabled) {
    console.log("[raffle-draw] job automatico desativado");
    return;
  }
  if (timer) return;

  const intervalMs = Math.max(env.raffleDrawRetryIntervalMs, 60_000);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processDueAutomaticRaffles();
      if (result.processed > 0) {
        console.log(`[raffle-draw] ${result.processed} rifa(s) processada(s)`);
      }
    } catch (error) {
      console.error("[raffle-draw] falha ao processar rifas automaticas", error);
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(tick, intervalMs);
  console.log(`[raffle-draw] job automatico ativo a cada ${intervalMs}ms`);
}

export function stopRaffleDrawJob() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
