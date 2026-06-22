# Auditoria pre-producao - 22/06/2026

## Ambientes identificados

- Producao web: Render `deliverycoite-node`, branch `main`.
- Producao banco: Render PostgreSQL `deliverycoite-db`, PostgreSQL 18.
- Homologacao web: Render `deliverycoite-homolog`, branch `feature/multiempresa`.
- Homologacao banco: Supabase `kfyunggutuqxiqbftlek`.

Os dois bancos estao em planos gratuitos e nao possuem backup nativo/PITR.
O banco Render informa expiracao em 13/07/2026 se nao houver upgrade.

## Backups

Foram gerados dumps logicos completos e restauraveis, schema, dados e relatorio
somente leitura em `backups/promotion-audit-20260622-041949/`.
Esse diretorio e ignorado pelo Git e nao contem arquivos de credenciais.

- SHA-256 producao `full.dump`:
  `AD1993B9A15A0B38F765BE1E0A9F38B23795366F3EC39B4FEBE0FEE36BBF5948`
- SHA-256 homologacao `full.dump`:
  `10C2BD317073DE0A9686C28F9F8A62EB96FD9F432D7D3DBEB9380582A4453A5B`

O dump de producao foi restaurado com sucesso em PostgreSQL local 18.

## Ensaio das migrations

As seis migrations PostgreSQL foram executadas sobre a restauracao da producao.
Todas as linhas operacionais foram preservadas. A empresa padrao foi criada e
os registros existentes receberam `companyId=default-company`.

Depois da migration de alinhamento, `prisma migrate diff` retornou migration
vazia: o schema restaurado ficou equivalente ao schema candidato.

## Diferencas principais

Producao ainda possui schema monoempresa com 19 tabelas publicas. Homologacao
possui 24 tabelas publicas, incluindo `Company`, `Driver`, `DeliveryRoute`,
`DeliveryRouteOrder` e `DriverDeviceToken`.

Nao foi encontrada tabela `_prisma_migrations` nos relatórios dos dois bancos.
Por isso, a promocao deve usar os SQLs revisados de forma controlada e registrar
manualmente a execucao, sem `prisma migrate deploy` automatico.

## Validacoes

- API TypeScript: aprovada.
- Frontend Next.js: aprovado.
- App motoboy TypeScript: aprovado.
- ESLint API: aprovado.
- Prisma schema: aprovado.
- Testes de rota/oferta e WhatsApp: 6 aprovados.
- Dependencias web/API: sem vulnerabilidade alta ou critica apos atualizacao.

## Pendencias antes da execucao

- confirmar janela de manutencao;
- confirmar upgrade/continuidade do banco Render antes de 13/07/2026;
- cadastrar variaveis ausentes na producao;
- pausar auto-deploy durante a janela;
- gerar backup final imediatamente antes da migration;
- obter autorizacao explicita para migration, merge e deploy.
