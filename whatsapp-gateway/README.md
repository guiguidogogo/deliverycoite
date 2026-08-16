# HubRegional WhatsApp Gateway

Gateway central, multi-tenant e independente para Evolution API 2.3.7. Cada SaaS recebe sua própria chave e só acessa tenants pertencentes à sua aplicação. A chave global da Evolution permanece exclusivamente no Gateway.

## Arquitetura

`SaaS backend -> Gateway API -> Redis/BullMQ -> Worker -> Evolution API`

O Gateway usa PostgreSQL próprio. O frontend nunca deve chamar o Gateway ou a Evolution diretamente; a chamada parte do backend de cada SaaS.

## Implantação no Coolify

1. Crie um projeto/serviço separado usando este diretório e o `docker-compose.yml`.
2. Copie `.env.example` para as variáveis do Coolify e gere senhas aleatórias fortes para `POSTGRES_PASSWORD`, `EVOLUTION_API_KEY` e `WEBHOOK_SECRET`.
3. Aponte `APP_URL` para o domínio HTTPS público do Gateway. Não inclua barra final.
4. Use `EVOLUTION_API_URL=https://evolution.hubregional.com.br` (sem `/manager` e, no proxy público atual, sem `:8080`).
5. Publique apenas o serviço `gateway`; PostgreSQL e Redis devem permanecer internos.
6. O container executa `prisma migrate deploy` antes de iniciar. Os volumes preservam banco e fila após reinícios.

## Criar a primeira aplicação

Abra o terminal do container `gateway`:

```sh
node dist/src/cli.js create-app --slug delivery --name Delivery
```

A chave é exibida uma única vez. Guarde-a no backend do Delivery como `HUB_WHATSAPP_KEY`. Para rotação sem interrupção:

```sh
node dist/src/cli.js rotate-key --slug delivery --key-name august-rotation
node dist/src/cli.js revoke-key --prefix hr_app_delivery_PREFIXO_ANTIGO
```

## API

Todas as rotas autenticadas usam `X-Hub-Api-Key`. A base é `/api/v1`.

- `POST /tenants`
- `POST /whatsapp/instances`
- `GET /whatsapp/instances/:tenantId/qrcode`
- `GET /whatsapp/instances/:tenantId/status`
- `POST /whatsapp/instances/:tenantId/reconnect`
- `POST /whatsapp/instances/:tenantId/logout`
- `DELETE /whatsapp/instances/:tenantId` com `X-Confirm-Delete: true`
- `POST /whatsapp/send/text`
- `POST /whatsapp/send/image`
- `POST /whatsapp/send/document`
- `GET /whatsapp/jobs/:jobId`

Envios aceitam `Idempotency-Key` e retornam `202` com `job_id`. Consulte o job para o resultado final.

## Operação e segurança

- `/health` verifica banco, Redis e Evolution; `/ready` determina se a API pode receber tráfego.
- QR Codes não são persistidos e as respostas usam `Cache-Control: no-store`.
- API Keys usam scrypt com salt; somente o prefixo pesquisável fica em texto claro.
- Logs estruturados removem chaves, QR/base64 e identificadores sensíveis.
- Rate limits são distribuídos por aplicação, tenant e instância.
- O webhook exige `x-webhook-secret`, configurado automaticamente em cada instância criada.
- A exclusão de instância é explícita e nunca ocorre por queda temporária.

## Desenvolvimento

```sh
npm install
npm run build
npm test
docker compose up --build
```
