# Relatorio do modulo de expedicao e entregas

## Escopo

Implementacao destinada exclusivamente a branch `feature/multiempresa` e ao ambiente de homologacao.

## Banco de dados

Foram adicionadas as entidades:

- `Driver`: motoboy isolado por `companyId`.
- `DeliveryRoute`: rota atribuida a um motoboy.
- `DeliveryRouteOrder`: pedidos e sequencia de cada rota.

Status de rota:

- `CREATED`
- `IN_PROGRESS`
- `COMPLETED`
- `CANCELED`

A migration `20260621130000_add_delivery_routes` e aditiva. Ela nao remove nem transforma dados existentes.

## API

Endpoints protegidos pela permissao `ORDERS`:

- `GET /admin/deliveries/orders`
- `GET /admin/deliveries/drivers`
- `POST /admin/deliveries/drivers`
- `PATCH /admin/deliveries/drivers/:id`
- `GET /admin/deliveries/routes`
- `POST /admin/deliveries/routes`
- `GET /admin/deliveries/routes/:id`
- `PATCH /admin/deliveries/routes/:id/status`

Todas as leituras e alteracoes validam o `companyId` da sessao.

## Regras implementadas

- Apenas pedidos de entrega com status `PREPARING` aparecem como prontos.
- Pedidos de retirada, cancelados, finalizados ou ja vinculados a uma rota ativa sao bloqueados.
- Ao criar uma rota, os pedidos passam para `OUT_FOR_DELIVERY`.
- Ao concluir a rota, os pedidos passam para `DELIVERED`.
- Ao cancelar a rota, pedidos ainda em entrega retornam para `PREPARING`.
- Pedidos com coordenadas sao ordenados pela heuristica de vizinho mais proximo.
- Pedidos sem coordenadas permanecem na rota usando endereco textual.
- A origem usa as coordenadas da loja; quando indisponiveis, usa o endereco cadastrado da empresa.

## Frontend

Nova tela:

`/admin/manage/deliveries`

Recursos:

- cadastro e ativacao/desativacao de motoboys;
- selecao em massa de pedidos;
- escolha de motoboy em modal;
- exibicao da sequencia sugerida;
- abertura no Google Maps;
- abertura do ultimo destino no Waze;
- mensagem pronta para WhatsApp;
- inicio, conclusao e cancelamento da rota;
- atalho `Entregas` no painel administrativo;
- botao `Enviar para entrega` nos pedidos em preparo.

## Roteiro de homologacao

1. Publicar a branch `feature/multiempresa` no servico `deliverycoite-homolog`.
2. Aplicar a migration somente no banco Supabase de teste.
3. Acessar o painel de uma empresa e abrir `Entregas`.
4. Cadastrar um motoboy com WhatsApp.
5. Criar ao menos tres pedidos de entrega e deixa-los em `Em preparo`.
6. Selecionar os tres pedidos e criar uma rota.
7. Confirmar a sequencia exibida e abrir o link do Google Maps.
8. Abrir a mensagem do WhatsApp do motoboy.
9. Iniciar e concluir a rota, confirmando que os pedidos passam para `Entregue`.
10. Repetir o teste cancelando uma rota e confirmar que os pedidos retornam para `Em preparo`.
11. Entrar em outra empresa e confirmar que motoboys, pedidos e rotas anteriores nao aparecem.

## Validacoes executadas

- Prisma schema validado.
- Prisma Client regenerado.
- TypeScript da API aprovado.
- Build de producao do frontend aprovado.
- Nenhuma migration executada em banco de producao.
