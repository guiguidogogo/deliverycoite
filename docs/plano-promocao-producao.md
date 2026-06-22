# Plano de promocao para producao

## Regra de seguranca

Nenhum deploy deve executar `prisma db push`, seed ou migration automaticamente.
O banco deve ser migrado em uma etapa manual, depois de backup e ensaio em copia
restaurada da producao.

## Pre-requisitos

- commit candidato congelado;
- backup nativo/PITR confirmado nos dois projetos Supabase;
- backup logico completo de producao e homologacao;
- schema real dos dois bancos exportado;
- migration PostgreSQL revisada e ensaiada sobre uma copia da producao;
- variaveis de producao conferidas;
- build da API, web e aplicativo aprovados.

## Backup e comparacao

Defina as URLs de sessao do Supabase somente na sessao do terminal:

```powershell
$env:PRODUCTION_DATABASE_URL = "postgresql://..."
$env:HOMOLOGATION_DATABASE_URL = "postgresql://..."
$env:POSTGRES_BIN = "C:\caminho\para\pgsql\bin"
.\scripts\backup-and-audit.ps1
```

O script gera `roles.sql`, `schema.sql`, `data.sql`, hashes SHA-256 e a
comparacao dos schemas dentro de `backups/`, que e ignorado pelo Git.

Antes da migration, execute `scripts/production-preflight.sql` com uma conexao
somente leitura e arquive a saida junto aos backups.

## Ordem da janela de migracao

1. Ativar manutencao ou suspender gravacoes.
2. Gerar backup final e registrar horario/hashes.
3. Executar validacoes de contagem e integridade.
4. Aplicar a migration PostgreSQL aprovada em transacao quando possivel.
5. Validar schema e contagens novamente.
6. Promover o commit aprovado para `main`.
7. Fazer deploy com migrations automaticas e seed desativados.
8. Executar smoke tests de login, catalogo, pedidos, caixa, empresas, entregas e motoboy.
9. Liberar gravacoes.

## Rollback

Codigo e banco devem voltar juntos. Se a migration falhar, interromper o deploy,
restaurar o backup/PITR e recolocar o commit anterior. Nao tentar corrigir dados
manualmente durante a janela sem um novo plano aprovado.
