# Convites

Crie a aplicação `convites` e registre cada cliente como tenant. Para convites, use `/whatsapp/send/image` ou `/whatsapp/send/document`; sempre envie uma `Idempotency-Key` derivada do convite para impedir duplicidade após timeouts. A resposta é assíncrona e deve ser acompanhada por `/whatsapp/jobs/:jobId`.
