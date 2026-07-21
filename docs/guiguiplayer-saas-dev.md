# GuiGuiPlayer no Hub Regional — implantação DEV

O módulo fica isolado no Painel Master SaaS, em `/admin/apps`. Ele não reutiliza
as áreas operacionais de Delivery, Rifas ou clientes das lojas.

## Fluxo

1. O administrador master abre **Gerenciador de Apps**.
2. Seleciona a empresa cliente, validade, limite de aparelhos e credenciais IPTV.
3. O Hub gera um código de ativação, exibido uma única vez.
4. A Roku gera um código de pareamento e um QR Code com validade de 10 minutos.
5. O cliente lê o QR Code e informa o código de ativação entregue pelo vendedor.
6. A Roku recebe as credenciais uma vez e confirma o recebimento.

As credenciais IPTV são armazenadas com AES-256-GCM. O banco não recebe servidor,
usuário ou senha em texto aberto.

## Variáveis da API no DEV

```env
APP_ENV=development
ALLOW_PRODUCTION_SEED=false
IPTV_CREDENTIALS_KEY=uma-chave-exclusiva-com-no-minimo-32-caracteres
IPTV_PAIRING_WEB_URL=https://ENDERECO-DA-APLICACAO-WEB-DEV
```

`IPTV_CREDENTIALS_KEY` não deve ser igual ao `JWT_SECRET`, não deve ser enviada
em capturas de tela e precisa ser guardada em local seguro. Perder essa chave
impede a leitura das credenciais já criptografadas.

## Banco DEV

Com a API apontando exclusivamente para o PostgreSQL DEV:

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

A migration adicionada é `20260721150000_guiguiplayer_saas`. Não execute no
banco oficial antes da homologação e de um backup aprovado.

## Validação

- abrir `/admin/apps` como administrador master;
- criar uma licença de teste com validade curta;
- copiar o código de ativação;
- instalar o canal Roku DEV;
- ler o QR Code e ativar;
- confirmar que a TV carrega a lista;
- bloquear o aparelho no Gerenciador de Apps e testar uma nova ativação;
- renovar, expirar e reativar a licença.
