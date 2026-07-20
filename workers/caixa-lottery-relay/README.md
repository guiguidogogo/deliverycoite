# Relay CAIXA (DEV)

Relay minimo para contornar bloqueios de IP de datacenter na consulta oficial das Loterias CAIXA.

- aceita somente `GET /federal` e `GET /federal/:concurso`;
- exige o header secreto `x-caixa-relay-token`;
- nao aceita URL de destino informada pelo cliente;
- nao armazena nem expoe dados pessoais;
- a CAIXA continua sendo a fonte do resultado.

Configure o segredo `RELAY_TOKEN` no Worker e o mesmo valor em
`CAIXA_LOTTERY_RELAY_TOKEN` somente no backend DEV.
