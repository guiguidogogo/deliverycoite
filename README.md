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
docker compose up -d db
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

Use o `render.yaml` da raiz para criar um Web Service chamado
`deliverycoite-node`. O mesmo servico executa o site Next.js e a API Express,
e aplica as migracoes automaticamente ao iniciar.

Configure no Render:

- `DATABASE_URL`: conexao PostgreSQL do ambiente
- `CORS_ORIGIN`: URL publica do site
- `NEXT_PUBLIC_API_URL`: mantenha `/api`
- `ROOT_DOMAIN`: `hubregional.com.br`
- `NEXT_PUBLIC_ROOT_DOMAIN`: `hubregional.com.br`
- `WHATSAPP_NUMBER`: numero da loja

Nao use `localhost` na `DATABASE_URL`. No Render, `localhost` aponta para o
proprio container.

## Multiempresa e homologacao

- A resolucao da empresa ocorre pelo subdominio, dominio personalizado ou pelo
  header `x-company-subdomain` em testes.
- O `companyId` e carregado no JWT e validado novamente no banco a cada
  requisicao autenticada.
- Dados operacionais usam `companyId` obrigatorio e consultas administrativas
  sao sempre limitadas ao tenant autenticado.
- A empresa publica atual pode ser consultada em `GET /api/company`.
- Em homologacao, use
  `https://deliverycoite-homolog.onrender.com/?subdomain=nome-da-empresa`.

### DNS wildcard

Para habilitar URLs reais como `yasminlanches.hubregional.com.br`:

1. adicione `hubregional.com.br` como dominio customizado no servico web;
2. adicione `*.hubregional.com.br` como dominio wildcard no mesmo servico;
3. no provedor DNS, crie o registro wildcard solicitado pelo Render, normalmente:
   - tipo `CNAME`;
   - nome `*`;
   - destino fornecido pelo Render;
4. mantenha `ROOT_DOMAIN=hubregional.com.br`;
5. aguarde a emissao do certificado TLS wildcard.

Subdominios inexistentes em `*.hubregional.com.br` retornam `404` e nunca
herdam os dados da empresa padrao. Em rotas autenticadas, o tenant resolvido
pelo host precisa coincidir com o `companyId` do JWT.

Para aplicar a conversao no banco de homologacao:

```bash
APP_ENV=staging DATABASE_URL="postgresql://..." \
  npm run migrate:multiempresa:test -w @delivery/api
npm run prisma:seed -w @delivery/api
```

O comando recusa ambientes diferentes de teste/homologacao e bloqueia URLs que
contenham `prod` ou `production`. A migration cria a empresa padrao
`Delivery Coité`, vincula os dados existentes e somente depois torna
`companyId` obrigatorio.

Nao execute essa migration diretamente em producao. Antes da promocao:

1. tire backup do banco;
2. restaure uma copia em homologacao;
3. rode a migration e o seed;
4. valide build, login, produtos, pedidos, complementos, cupons, caixa e configuracoes;
5. aprove o merge da branch `feature/multiempresa`.

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
