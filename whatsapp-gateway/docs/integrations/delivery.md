# Delivery

Configure apenas no backend: `HUB_WHATSAPP_URL` e `HUB_WHATSAPP_KEY`. Cadastre a empresa com `POST /api/v1/tenants`, usando o ID interno estável em `external_tenant_id`. Depois crie a instância e faça polling de `/status` a cada 3–5 segundos durante a conexão. Envios de pedidos devem usar uma `Idempotency-Key` por evento de negócio.
