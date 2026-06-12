# Delivery Web (Lanchonete)

Aplicacao web completa (mobile-first) para cardapio, pedido por WhatsApp e painel administrativo.

## Stack

- Frontend: Next.js 14 + TypeScript + Tailwind + PWA
- Backend: Node.js + Express + TypeScript + Prisma + JWT
- Banco: PostgreSQL
- Infra local: Docker Compose

## Modulos implementados

### Loja (cliente)

- Tela inicial com banner e categorias
- Cardapio com foto, descricao, preco e botao adicionar
- Busca de produtos
- Favoritos (cliente)
- Carrinho com alteracao de quantidade e remocao
- Checkout com:
  - Nome
  - Telefone
  - Endereco
  - Numero
  - Bairro
  - Complemento
  - Pagamento (Dinheiro/PIX/Cartao)
  - Troco para
- Cupons de desconto (PROMO10 no frontend e cupons reais no backend)
- QR Code PIX (configuravel)
- Confirmacao do pedido com redirecionamento automatico para WhatsApp
- Dark mode
- PWA instalavel

### Painel administrativo

- Login protegido (JWT)
- Perfis: ADMIN e ATTENDANT
- Dashboard com:
  - Pedidos do dia
  - Faturamento do dia
  - Faturamento mensal
  - Ticket medio
  - Produtos mais vendidos
  - Pedidos pendentes
- Gestao de pedidos:
  - Lista
  - Filtros
  - Busca por cliente
  - Alteracao de status
  - Marcar como visualizado
- Notificacao de novo pedido:
  - Polling
  - Alerta visual
  - Som de notificacao
- Relatorios:
  - Exportacao PDF
  - Exportacao Excel

### Backoffice/API

- CRUD categorias
- CRUD produtos
- CRUD cupons
- Configuracoes gerais da empresa
- Endpoint de integracoes futuras:
  - iFood
  - Mercado Pago
  - PIX automatico

### Operacao e qualidade

- Validacao de dados com Zod
- Seguranca basica com Helmet + CORS + Rate limit
- Logs com Morgan e tratamento global de erros
- Backup automatico diario em JSON (03:00)
- Gancho de impressao termica (adaptavel para ESC/POS)
- Arquitetura em monorepo (apps/web + apps/api)

## Estrutura

- apps/web: frontend Next.js
- apps/api: API Express + Prisma
- docker-compose.yml: Postgres + API + Web

## Configuracao local (PC)

1. Instale Node.js 20+ e Docker Desktop.
2. Copie `.env.example` para `.env`.
3. Ajuste as variaveis se necessario.
   Para usar a Menuia, configure `MENUIA_API_BASE_URL` e `MENUIA_LICENSE` se os valores
   forem diferentes de `https://chatbot.menuia.com` e `hugocursos`.
4. Instale dependencias:

```bash
npm install
```

5. Suba o banco:

```bash
docker compose up -d postgres
```

6. Gere o client Prisma e rode migracoes:

```bash
npm run prisma:generate -w @delivery/api
npm run prisma:migrate -w @delivery/api
npm run prisma:seed -w @delivery/api
```

7. Suba frontend + backend:

```bash
npm run dev
```

- Frontend: http://localhost:3000
- API: http://localhost:3333
- Admin login: /admin/login

## Docker full stack

```bash
docker compose up --build
```

## Deploy no Render

Use o `render.yaml` da raiz para criar dois Web Services:

- `delivery-api`: API Express
- `delivery-web`: site Next.js

Configure no Render:

- `DATABASE_URL`: conexao MySQL externa, no formato `mysql://usuario:senha@host:3306/banco?sslaccept=strict`
- `CORS_ORIGIN`: URL publica do site
- `NEXT_PUBLIC_API_URL`: URL publica da API terminando em `/api`
- `WHATSAPP_NUMBER`: numero da loja

Nao use `localhost` na `DATABASE_URL`. No Render, `localhost` aponta para o
proprio container, nao para o MySQL instalado no seu computador.

## Banco de dados

Tabelas no schema Prisma:

- users
- products
- categories
- orders
- order_items
- customers
- settings
- coupons
- favorites

## Fluxo WhatsApp

Ao confirmar pedido, API monta mensagem formatada e retorna `whatsappUrl` no formato:

`https://wa.me/NUMERO?text=MENSAGEM`

O frontend redireciona automaticamente.

## Proximos passos recomendados

- Tela administrativa completa para CRUD visual de produtos/categorias/configuracoes
- WebSocket para notificacoes em tempo real
- Integracao real com impressora termica
- Gateway PIX automatico e Mercado Pago
- Suite de testes (unitario/integracao/E2E)
