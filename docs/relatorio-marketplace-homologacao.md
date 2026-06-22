# Marketplace HubRegional — homologação

## Escopo

- Branch: `feature/multiempresa`
- Serviço: `deliverycoite-homolog`
- Banco: Supabase de homologação
- Produção: não alterada

## Implementado

- Home institucional e marketplace no domínio central.
- Loja individual preservada por subdomínio ou `?subdomain=` na homologação.
- Busca pública por empresa, categoria e cidade.
- Categorias: Lanches, Pizzaria, Açaí, Marmitas, Sushi, Conveniência, Farmácia e Mercado.
- Seções de empresas em destaque, mais vendidas, promoções e próximas.
- Cards com logo, nome, categoria, cidade, prazo, taxa, avaliação e status.
- Seções institucionais para clientes, empresas e motoboys.
- Campos de marketplace no cadastro/edição de empresas.
- API pública `GET /api/marketplace/companies`.
- API pública `GET /api/marketplace/summary`.

## Migration de homologação

Migration aditiva:

`20260622170000_marketplace_company_fields`

Campos adicionados à `Company`:

- `marketplaceVisible`
- `featured`
- `category`
- `city`
- `isOpen`
- `deliveryFee`
- `deliveryTimeMin`
- `rating`

A migration não remove tabelas, colunas ou registros.

## Roteiro de teste

1. Abrir `https://deliverycoite-homolog.onrender.com`.
2. Confirmar que a home exibe o HubRegional e não uma loja específica.
3. Buscar uma empresa pelo nome.
4. Filtrar pelas categorias.
5. Abrir o card de uma empresa.
6. Confirmar que o cardápio correto foi carregado.
7. Entrar como MASTER e editar categoria, cidade, taxa, prazo e destaque.
8. Desativar `Exibir no marketplace` e confirmar que a empresa deixa de aparecer.
9. Reativar a opção e confirmar que ela volta à listagem.

## Promoção futura

Somente após aprovação:

1. Fazer backup de produção.
2. Revisar os dados padrão de cada empresa.
3. Aplicar a mesma migration aditiva no banco de produção.
4. Promover o commit aprovado da `feature/multiempresa`.
5. Validar domínio central e subdomínios.
