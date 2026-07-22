import assert from "node:assert/strict";
import {
  extractWinningDigits,
  getSaoPauloDateKey,
  isTransientCaixaHttpStatus,
  isSupportedRaffleCaixaModality,
  normalizeCaixaModality
} from "./caixa-lottery-service.js";

assert.equal(normalizeCaixaModality(" Federal "), "federal");
assert.equal(isSupportedRaffleCaixaModality("federal"), true);
assert.equal(isSupportedRaffleCaixaModality("megasena"), false);

assert.equal(extractWinningDigits("12345", 2), "45");
assert.equal(extractWinningDigits("12345", 3), "345");
assert.equal(extractWinningDigits("12345", 4), "2345");
assert.equal(extractWinningDigits("12345", 5), "12345");
assert.equal(extractWinningDigits("017667", 2), "67");
assert.equal(extractWinningDigits("017667", 4), "7667");
assert.equal(extractWinningDigits("017667", 6), "017667");
assert.equal(extractWinningDigits("00045", 4), "0045");
assert.equal(extractWinningDigits("45", 4), "0045");

assert.equal(getSaoPauloDateKey(new Date("2026-07-14T03:00:00.000Z")), "2026-07-14");
assert.equal(isTransientCaixaHttpStatus(403), false);
assert.equal(isTransientCaixaHttpStatus(404), true);
assert.equal(isTransientCaixaHttpStatus(429), true);
assert.equal(isTransientCaixaHttpStatus(500), true);

console.log("raffle draw service tests passed");
