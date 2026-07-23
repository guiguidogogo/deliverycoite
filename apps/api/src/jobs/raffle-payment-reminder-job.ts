import { processDueRafflePaymentReminders } from "../services/raffle-payment-reminder-service.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startRafflePaymentReminderJob() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processDueRafflePaymentReminders();
      if (result.processed) console.log(`[raffle-reminder] ${result.sent}/${result.processed} enviado(s)`);
    } catch (error) {
      console.error("[raffle-reminder] falha", error);
    } finally {
      running = false;
    }
  };
  void tick();
  timer = setInterval(tick, 15 * 60 * 1000);
}
