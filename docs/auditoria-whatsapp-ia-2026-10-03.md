# Auditoria: pedidos por IA no WhatsApp

Data: 03/10/2026  
Branch auditada: `codex/restore-admin-menu` (`72522e3`)

## 1. Estrutura e tecnologias

Monorepo npm com `apps/api` (Node.js, TypeScript, Express, Prisma e PostgreSQL), `apps/web` (Next.js), aplicativo de entregador e agente de impressão. Validação com Zod, autenticação JWT, rate limiting e comunicação em tempo real por WebSocket.

## 2. Banco existente

Já existem entidades multiempresa para `Company`, `Category`, `Product`, `Complement`, `ProductComplement`, `Customer`, `CustomerAddress`, `Order`, `OrderItem`, `OrderItemComplement`, `Setting`, `DeliveryFeeTier` e horários comerciais. Todas as principais entidades comerciais possuem `companyId`.

## 3. Evolution/WhatsApp atual

O SaaS não fala diretamente com a Evolution: usa o gateway central em `services/hub-whatsapp.ts`, com tenant, chave de API e idempotência de envio. Conexão, QR code, status, reconexão, logout, texto e mídia já estão implementados. A caixa de entrada persistente está em `whatsapp-inbox-controller.ts`.

## 4. Localização e frete

O webhook da caixa de entrada recebe latitude/longitude, faz geocodificação reversa quando necessário, evita endereço duplicado e cria/atualiza `CustomerAddress`. Essa lógica deve ser preservada. O frete é calculado exclusivamente por `utils/delivery-fee.ts`, usando `Setting`, coordenadas da loja e `DeliveryFeeTier`; sem localização, informa `requiresLocation`.

## 5. Pedidos e cardápio

O cardápio real já usa categorias, produtos, preços promocionais, disponibilidade, estoque e complementos. Pedidos já armazenam cliente, itens, complementos, subtotal, desconto, frete, coordenadas, forma de pagamento, troco e origem. O enum `OrderSource` ainda precisará receber `WHATSAPP` antes da criação automática de pedidos.

## 6. n8n e Ollama

Não havia workflow n8n versionado. Havia um protótipo em `whatsapp-ai-controller.ts` que chamava Ollama diretamente, estava fixado em uma loja, não persistia sessão e não consultava o cardápio. Ele não atendia ao isolamento multi-tenant nem ao fluxo comercial proposto.

## 7. Alterações iniciadas

- sessão persistente de conversa por empresa e telefone;
- histórico resumível de mensagens;
- idempotência de webhook por empresa e ID externo;
- tenant obrigatório e validado;
- chave privada entre n8n e SaaS;
- saída do Ollama validada com Zod;
- consulta real de categorias/produtos/preços;
- desambiguação de produtos;
- estado `HUMAN_SUPPORT` persistente;
- modo seguro em que o backend devolve a resposta ao n8n, sem disparar WhatsApp diretamente.

## 8. Próximas migrations/fases

Depois da fundação atual: carrinho persistente e opções flexíveis; regra configurável de múltiplos sabores; pagamento habilitado por empresa; enum de origem WhatsApp; retomada após localização; confirmação idempotente; comandos de assumir/devolver conversa no painel; workflow n8n versionado e testes de conversação.

## 9. Arquivos centrais

- `apps/api/prisma/schema.prisma`
- `apps/api/src/controllers/whatsapp-ai-controller.ts`
- `apps/api/src/controllers/whatsapp-inbox-controller.ts`
- `apps/api/src/services/hub-whatsapp.ts`
- `apps/api/src/utils/delivery-fee.ts`
- `apps/api/src/controllers/orders-controller.ts`
- `apps/api/src/routes/index.ts`
- `apps/web/app/admin/whatsapp/page.tsx`

## 10. Reaproveitamento obrigatório

Gateway central do WhatsApp, caixa de entrada, vínculo de telefone/cliente, persistência de localização, `CustomerAddress`, cálculo de frete, regras de horário, catálogo, complementos, criação de pedidos, painel e autenticação existentes.
