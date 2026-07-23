void import("./index.mjs").catch((error) => {
  console.error("[lottery-collector] falha ao iniciar no Passenger", error);
  process.exitCode = 1;
});
