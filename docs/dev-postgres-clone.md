# DEV isolado com clone da producao

Este guia descreve a melhor pratica para trabalhar com o HubRegional em
ambiente de desenvolvimento/homologacao sem tocar no banco de producao.

## Objetivo

- manter `production` intacto;
- criar um `DEV` separado com copia do banco real;
- apontar a aplicacao DEV apenas para o banco DEV;
- aplicar migrations e seed somente no DEV;
- validar login, pedidos, configuracoes e admin antes de promover para o
  ambiente oficial.

## Configuracao recomendada

### Producao

Use a conexao real do PostgreSQL da operacao publica:

```env
APP_ENV=production
ALLOW_PRODUCTION_SEED=false
DATABASE_URL=postgresql://...
```

Nao execute seed manual nem migrations destrutivas em producao sem aprovacao.

### DEV / homologacao

Use um banco PostgreSQL separado, restaurado a partir de um backup da
producao:

```env
APP_ENV=development
ALLOW_PRODUCTION_SEED=false
DATABASE_URL=postgresql://USUARIO:SENHA@HOST_DEV:5432/NOME_DEV?schema=public
JWT_SECRET=uma_chave_diferente_da_producao
ROOT_DOMAIN=hubregional.com.br
NEXT_PUBLIC_ROOT_DOMAIN=hubregional.com.br
```

Opcionalmente, mantenha os dados de integracao abaixo iguais aos do ambiente
testado ou deixe vazios se o DEV nao for usarlos:

```env
MENUIA_API_BASE_URL=https://chatbot.menuia.com
MENUIA_LICENSE=hugocursos
WHATSAPP_NUMBER=5575999999999
```

## Como copiar a base da producao para o DEV

### Opcao 1: backup e restore

1. Gere o dump do banco de producao:

```bash
pg_dump -h HOST_PROD -U USUARIO_PROD -d BANCO_PROD -Fc -f hubregional-prod.dump
```

2. Restaure no banco DEV:

```bash
pg_restore -h HOST_DEV -U USUARIO_DEV -d BANCO_DEV --clean --if-exists hubregional-prod.dump
```

### Opcao 2: ferramenta do provedor

Se o provedor de infra tiver backup/restauracao automatica, use o backup da
producao e restaure em um recurso DEV separado.

## Ordem correta de bootstrap no DEV

Depois de restaurar o banco DEV:

```bash
npx prisma migrate deploy
npx prisma db seed
```

O seed esta bloqueado em producao. No DEV ele cria:

- empresa `yasmimlanches`;
- administrador da loja `yasmimlanches@gmail.com` / `123456`;
- master global `admin@hubregional.com.br` / `123456`.

## Checagens antes de promover

Valide no DEV:

- login admin;
- salvamento de configuracoes;
- menuia / mercadopago / impressao;
- pedidos do frontend;
- carrinho e checkout;
- painel admin.

Somente depois disso promova o mesmo codigo para o ambiente oficial.
