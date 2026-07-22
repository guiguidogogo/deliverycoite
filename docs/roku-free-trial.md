# Teste gratuito da Roku

## Regra

- Cada Roku recebe um unico teste gratuito de 3 dias.
- O prazo e vinculado ao identificador da Roku por um hash armazenado no servidor.
- Reinstalar o canal ou gerar outro QR Code nao reinicia o prazo.
- Uma licenca paga ativa sempre tem prioridade sobre o teste.
- Depois do vencimento, a API bloqueia a validacao e a alteracao da lista sem um codigo de acesso pago.

## Fluxo

1. A Roku solicita um pareamento.
2. A API cria ou recupera o registro `AppDeviceTrial`.
3. Durante o teste, o QR Code permite cadastrar host, login e senha sem codigo pago.
4. A Roku salva a configuracao e valida o prazo na API a cada cinco minutos.
5. Ao vencer, a reproducao e interrompida e a tela solicita ativacao.

## Migracao no ambiente DEV

Antes de publicar a nova API, aplique a migration no banco DEV:

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Nao execute esta migration diretamente em producao sem backup e validacao previa no DEV.

## Testes manuais

- Primeira instalacao cria um teste com aproximadamente 72 horas.
- QR Code aceita configuracao IPTV sem codigo pago durante o teste.
- Fechar e abrir o app preserva o mesmo vencimento.
- Reinstalar o app preserva o mesmo vencimento.
- Um codigo pago pode ser informado antes do fim do teste.
- Teste vencido bloqueia reproducao e exige codigo pago.
- Licenca paga ativa continua funcionando normalmente.
- Roku bloqueada ou assinatura vencida nao ganha um novo teste.
