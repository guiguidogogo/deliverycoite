# Configuração do workflow n8n

Importe `n8n/whatsapp-orders-foundation.json` e mantenha o workflow inativo até concluir os testes.

Variáveis obrigatórias no n8n:

- `SAAS_API_URL`: URL da API do clone de teste;
- `AUTOMATION_API_KEY`: mesma chave configurada na API;
- `HUB_WHATSAPP_URL`: URL interna/segura do gateway central;
- `HUB_WHATSAPP_KEY`: chave do gateway central.

Configure cada instância Evolution com o webhook de teste acrescentando o tenant na URL:

`https://SEU_N8N/webhook/delivery-whatsapp-ai?tenantId=ID_DA_EMPRESA`

O tenant da URL é validado novamente no SaaS. O workflow não calcula preços, frete ou total. Ele apenas normaliza o evento, chama o backend e envia a resposta validada.
