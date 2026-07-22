# Coletor da Loteria Federal — ambiente DEV

O coletor roda no segundo servidor Node.js e envia resultados brutos ao SaaS. O SaaS calcula o número ganhador e mantém o isolamento entre empresas.

## 1. Banco do SaaS

Aplicar a migration `20260722190000_lottery_result_inbox` somente no banco de desenvolvimento/homologação.

## 2. Segredo compartilhado

Gerar um valor aleatório com pelo menos 32 bytes. Exemplo com Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guardar o mesmo valor nos dois ambientes. Não adicionar o valor real ao Git.

## 3. Variáveis no SaaS DEV

```env
LOTTERY_COLLECTOR_WEBHOOK_ENABLED=true
LOTTERY_WEBHOOK_SECRET=valor-gerado
LOTTERY_WEBHOOK_MAX_AGE_SECONDS=300
RAFFLE_DRAW_JOB_ENABLED=false
```

Com `RAFFLE_DRAW_JOB_ENABLED=false`, o SaaS deixa de consultar a CAIXA diretamente por rifa. O botão de nova tentativa consulta primeiro o inbox local recebido do coletor.

## 4. Variáveis no servidor coletor DEV

Usar `apps/lottery-collector/.env.example` como referência:

```env
COLLECTOR_ENABLED=false
CAIXA_RESULTS_API_URL=https://servicebus2.caixa.gov.br/portaldeloterias/api/federal
SAAS_WEBHOOK_URL=https://endereco-dev-do-saas/api/integrations/lottery-results
LOTTERY_WEBHOOK_SECRET=mesmo-valor-do-saas
COLLECTOR_POLL_INTERVAL_MS=900000
COLLECTOR_REQUEST_TIMEOUT_MS=15000
COLLECTOR_WEBHOOK_MAX_RETRIES=5
COLLECTOR_HISTORY_LOOKBACK=10
COLLECTOR_STATE_FILE=./data/state.json
```

O diretório de execução deve ser `apps/lottery-collector` quando o app usar o `.env` local e o caminho de estado acima.

## 5. Primeiro teste

Com a API DEV e o banco DEV ativos:

```bash
npm run send:once -w @delivery/lottery-collector
```

O retorno esperado no coletor contém `DELIVERED`. No SaaS, o resultado aparece uma única vez em `LotteryResultInbox` e processa as rifas automáticas da data correspondente.

Para reenviar o último concurso em um teste idempotente:

```bash
npm run send:force -w @delivery/lottery-collector
```

## 6. Ativação contínua em DEV

Depois do teste manual, configurar `COLLECTOR_ENABLED=true` e iniciar:

```bash
npm start -w @delivery/lottery-collector
```

O coletor consulta no máximo uma vez por intervalo, percorre um histórico curto quando necessário e não funciona como proxy aberto.

Não habilitar em produção antes de validar migration, HTTPS, segredo, logs e resultado de uma rifa de teste sem pagamento real.
