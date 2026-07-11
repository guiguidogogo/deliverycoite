import { type NextRequest } from "next/server";

const apiServerUrl = (
  process.env.API_SERVER_URL
  ?? process.env.API_URL
  ?? (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "/api"
    ? process.env.NEXT_PUBLIC_API_URL
    : undefined)
  ?? "http://localhost:3333"
).replace(/\/$/, "");

const configuredRootDomain = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN
  ?? process.env.ROOT_DOMAIN
  ?? "hubregional.com.br"
)
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");

function normalizeHost(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "");
}

function normalizeSubdomain(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function rootDomainFromHost(host: string) {
  if (host.endsWith(".sslip.io")) {
    const parts = host.split(".");
    if (parts.length > 2) return parts.slice(1).join(".");
  }
  if (configuredRootDomain) return configuredRootDomain;
  return "hubregional.com.br";
}

function subdomainFromRequest(request: NextRequest) {
  const explicit = normalizeSubdomain(request.headers.get("x-company-subdomain") ?? request.nextUrl.searchParams.get("subdomain"));
  if (explicit) return explicit;

  const host = normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  const rootDomain = rootDomainFromHost(host);
  if (!host || !rootDomain) return "";
  if (host === rootDomain || host === `www.${rootDomain}` || host === `admin.${rootDomain}`) return "";
  if (!host.endsWith(`.${rootDomain}`)) return "";

  return normalizeSubdomain(host.slice(0, -(rootDomain.length + 1)));
}

const hopByHopRequestHeaders = [
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const targetUrl = new URL(`${apiServerUrl}/api/${path.map(encodeURIComponent).join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => targetUrl.searchParams.append(key, value));

  const headers = new Headers(request.headers);
  for (const header of hopByHopRequestHeaders) {
    headers.delete(header);
  }
  headers.set("x-forwarded-host", normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host")));

  const subdomain = subdomainFromRequest(request);
  if (subdomain && !headers.has("x-company-subdomain")) {
    headers.set("x-company-subdomain", subdomain);
  }
  if (subdomain && !targetUrl.searchParams.has("subdomain")) {
    targetUrl.searchParams.set("subdomain", subdomain);
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store"
    });
  } catch {
    return Response.json(
      { message: "API indisponivel no ambiente DEV. Verifique o servico da API no Coolify." },
      { status: 502 }
    );
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
