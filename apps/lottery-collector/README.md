# Coletor de resultados da Loteria Federal

Serviço Node.js separado que consulta uma vez o resultado oficial da Loteria Federal e o entrega ao SaaS por webhook HMAC. Ele não é um proxy genérico e não aceita URLs pela rede.

## Desenvolvimento

1. Copie `.env.example` para `.env` apenas neste app.
2. Configure `SAAS_WEBHOOK_URL` e o mesmo `LOTTERY_WEBHOOK_SECRET` do SaaS.
3. No SaaS, habilite `LOTTERY_COLLECTOR_WEBHOOK_ENABLED=true`.
4. Rode uma entrega idempotente:

```bash
npm run send:once -w @delivery/lottery-collector
```

Para reenviar conscientemente o último concurso durante testes:

```bash
npm run send:force -w @delivery/lottery-collector
```

O modo contínuo só inicia com `COLLECTOR_ENABLED=true`. O estado local fica em `data/state.json`, fora do Git.
Ao iniciar sem estado, o coletor percorre até `COLLECTOR_HISTORY_LOOKBACK` concursos anteriores e os entrega do mais antigo para o mais novo. Isso recupera rifas de dias anteriores sem calcular números de concurso.

No cPanel/Passenger, use `src/passenger.cjs` como startup file. O serviço mantém um endpoint HTTP em `/health` e escuta a porta ou socket fornecido por `PORT`.

Gere um segredo aleatório com pelo menos 32 bytes e nunca o salve no repositório. Em produção, use exclusivamente HTTPS no webhook.
