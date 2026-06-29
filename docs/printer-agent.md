# HubRegional Printer Agent

Aplicativo Windows local para imprimir pedidos automaticamente sem depender do navegador.

## Como configurar a loja

1. Acesse o painel admin da empresa.
2. Vá em **Configurações**.
3. Na seção **HubRegional Printer Agent**, clique em **Gerar token**.
4. Copie o token exibido.
5. Deixe a opção **Ativo** ligada.

> Por segurança, o token completo aparece apenas no momento em que é gerado. Se perder o token, gere outro.

## Como rodar em desenvolvimento

Na pasta do projeto:

```bash
npm run build -w @delivery/printer-agent
npm run start -w @delivery/printer-agent
```

## Como gerar instalador Windows

```bash
npm run dist -w @delivery/printer-agent
```

Os arquivos serão gerados em:

```text
apps/printer-agent/release
```

## Configuração no aplicativo

Preencha:

- **URL da API:** `https://hubregional.com.br/api`
- **Token da impressora:** token gerado no painel admin
- **Impressora principal:** escolha a impressora instalada no Windows
- Marque **Impressão automática**
- Opcional: marque **Iniciar com Windows** e **Minimizar para bandeja**

Depois clique em **Salvar e conectar**.

## Segurança

- Cada token pertence a uma única empresa.
- O agente só lista pedidos da empresa vinculada ao token.
- Pedidos pagos pelo Mercado Pago só entram na fila de impressão após confirmação do pagamento.
- Pedidos cancelados, finalizados ou apagados não entram na fila.
- Depois de impresso, o pedido é marcado no backend para evitar duplicidade.

## Rotas usadas pelo agente

- `GET /api/printer-agent/orders`
- `POST /api/printer-agent/orders/:id/printed`
- `POST /api/printer-agent/test`

Todas usam:

```http
Authorization: Bearer TOKEN_DA_IMPRESSORA
```
