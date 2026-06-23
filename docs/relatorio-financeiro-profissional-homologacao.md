# Financeiro profissional — homologação

## Ambiente

- Branch: `feature/multiempresa`
- Serviço: `deliverycoite-homolog`
- Banco: Supabase de homologação
- Produção: não alterada

## Entregas

- Caixa individual por operador.
- Registro de operador, abertura, IP, dispositivo, valor inicial e observações.
- Bloqueio de confirmação de venda sem caixa aberto para o operador.
- Entradas e saídas categorizadas.
- Fechamento com valor esperado, contado, diferença e justificativa obrigatória.
- Bloqueio de alterações após fechamento.
- Reabertura autorizada e auditada.
- Exclusão lógica de movimentos, pedidos e clientes.
- Auditoria de caixa, pagamentos, pedidos, produtos e clientes.
- Dashboard com faturamento, despesas, saldo, lucro estimado, ticket e caixas.
- Gráficos de vendas diárias e formas de pagamento.
- Contas a pagar e a receber com vencimento e status.
- Exportação financeira em PDF e Excel.
- Permissões de gerente, operador de caixa, financeiro e auditoria.
- Isolamento integral por `companyId`.

## Migration

`20260622223000_professional_finance_audit`

A migration é aditiva. Não remove tabelas, colunas ou registros.

## Testes sugeridos

1. Entrar como operador e abrir um caixa.
2. Tentar abrir outro caixa com o mesmo operador.
3. Registrar entradas, sangrias e despesas.
4. Confirmar uma venda e conferir o lançamento automático.
5. Fechar com diferença sem justificativa.
6. Fechar com justificativa e conferir bloqueio.
7. Reabrir com usuário autorizado.
8. Arquivar lançamento e conferir auditoria.
9. Cadastrar e pagar conta a pagar.
10. Cadastrar e receber conta a receber.
11. Exportar PDF e Excel.
12. Entrar em outra empresa e confirmar isolamento dos dados.
