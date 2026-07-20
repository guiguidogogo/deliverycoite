const CAIXA_BASE_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api";

function jsonError(status, message) {
  return Response.json({ error: message }, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return jsonError(405, "Metodo nao permitido.");

    const expectedToken = String(env.RELAY_TOKEN ?? "").trim();
    if (!expectedToken || request.headers.get("x-caixa-relay-token") !== expectedToken) {
      return jsonError(401, "Nao autorizado.");
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 1 || parts.length > 2 || parts[0] !== "federal") {
      return jsonError(404, "Somente a modalidade federal esta disponivel.");
    }

    const contest = parts[1];
    if (contest && !/^\d{1,8}$/.test(contest)) {
      return jsonError(400, "Concurso invalido.");
    }

    const upstreamUrl = `${CAIXA_BASE_URL}/federal${contest ? `/${contest}` : ""}`;
    try {
      const upstream = await fetch(upstreamUrl, {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "pt-BR,pt;q=0.9",
          referer: "https://loterias.caixa.gov.br/",
          "user-agent": "Mozilla/5.0 (compatible; HubRegional-LotteryRelay/1.0)"
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        }
      });
    } catch {
      return jsonError(502, "Falha temporaria ao consultar a CAIXA.");
    }
  }
};
