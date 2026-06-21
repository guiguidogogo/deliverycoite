# App HubRegional Motoboy

## Escopo

Aplicativo Expo criado em `apps/driver`, integrado exclusivamente com a API multiempresa.

## Funcionalidades

- login por telefone, senha e subdominio;
- token JWT exclusivo para motoboy;
- disponibilidade online/offline;
- lista de novas rotas e rotas em andamento;
- notificacao push com som ao receber uma rota;
- atualizacao automatica a cada 5 segundos com alerta local sonoro como fallback;
- aceite ou recusa da corrida;
- visualizacao dos pedidos, clientes, telefones, enderecos, itens e observacoes;
- abertura da rota no Google Maps;
- abertura do ultimo destino no Waze;
- envio periodico da localizacao GPS enquanto disponivel;
- marcacao individual de pedido entregue;
- conclusao automatica quando todos os pedidos forem entregues;
- historico de rotas concluidas e canceladas.

## Backend

Foram adicionados:

- `passwordHash`, disponibilidade e ultima localizacao em `Driver`;
- entidade `DriverDeviceToken`;
- autenticacao e middleware exclusivos do motoboy;
- registro de Expo Push Token;
- endpoints de perfil, disponibilidade, GPS, rotas, aceite, recusa e entrega;
- notificacao Expo ao criar uma rota;
- isolamento simultaneo por `driverId` e `companyId`.

## Preparacao da homologacao

1. Publicar a branch `feature/multiempresa` no servico `deliverycoite-homolog`.
2. Aplicar a migration `20260621160000_add_driver_mobile_app` somente no banco Supabase de teste.
3. No painel `/admin/manage/deliveries`, cadastrar um motoboy com senha.
4. Criar uma rota para esse motoboy.

## Rodar localmente

Na raiz do repositorio:

```bash
npm install
npx eas-cli login
cd apps/driver
copy .env.example .env
npx eas-cli init
npx eas-cli build --profile development --platform android
npm run start
```

Depois, instalar o development build no celular Android e abrir o QR Code exibido pelo Expo.

Para iOS:

```bash
npx eas-cli build --profile development --platform ios
```

## Notificacoes

O `eas init` deve adicionar `extra.eas.projectId` ao `app.json`.

Push remoto deve ser validado em aparelho ou build compatível com notificacoes. A notificacao abre diretamente a rota informada em `data.routeId`.

### Configurar Firebase no Android

1. Criar ou abrir um projeto no Firebase Console.
2. Adicionar um aplicativo Android com o package `br.com.hubregional.motoboy`.
3. Baixar `google-services.json` e salvar em `apps/driver/google-services.json`.
4. Em Firebase > Configuracoes do projeto > Contas de servico, gerar uma chave privada.
5. Executar `eas credentials --platform android`.
6. Selecionar o perfil usado no APK e configurar `Google Service Account > FCM V1`, enviando a chave privada.
7. Gerar e instalar um novo APK.

O arquivo `google-services.json` registra o aplicativo no Firebase. A chave privada de conta de servico e secreta e nao deve ser adicionada ao Git.

Nao coloque `firebase-admin` nem `serviceAccountKey.json` dentro do aplicativo. Neste projeto, a chave privada deve ser enviada diretamente ao EAS; a API envia notificacoes pelo Expo Push Service.

Depois de alterar `app.json`, notificacoes ou permissoes nativas, e obrigatorio gerar e instalar um novo APK. Atualizar apenas a API nao atualiza o aplicativo ja instalado.

O app exibe o estado `Push e som ativados` quando o token Expo foi registrado. O painel administrativo informa ao criar a rota se o push foi enviado, falhou ou se o motoboy ainda nao registrou um aparelho.

## Homologacao sugerida

1. Entrar no app com telefone, senha e subdominio.
2. Permitir notificacoes e GPS.
3. Alternar entre disponivel e indisponivel.
4. Criar uma rota pelo painel administrativo.
5. Confirmar notificacao com titulo `Nova rota de entrega` e alerta sonoro.
6. Abrir a notificacao e confirmar os detalhes da rota.
7. Recusar uma primeira rota e verificar que ela sai da lista ativa.
8. Criar outra rota, aceitar e confirmar pedidos em `Saiu para entrega`.
9. Abrir Google Maps e Waze.
10. Marcar os pedidos como entregues e confirmar a conclusao da rota.
11. Verificar a rota no historico.
12. Entrar com um motoboy de outra empresa e confirmar o isolamento dos dados.

## Validacoes

- migration aditiva criada, sem execucao em producao;
- Prisma e TypeScript da API validados;
- painel web validado;
- TypeScript do app validado;
- configuracao Expo validada localmente.
