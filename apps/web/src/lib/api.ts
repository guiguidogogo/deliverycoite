const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const CONFIGURED_ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, "") ?? "";

function normalizeHost(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "");
}

export function getBrowserRootDomain() {
  if (CONFIGURED_ROOT_DOMAIN) return CONFIGURED_ROOT_DOMAIN;
  if (typeof window === "undefined") return "hubregional.com.br";

  const host = normalizeHost(window.location.hostname);
  if (host.endsWith(".sslip.io")) {
    const parts = host.split(".");
    if (parts.length > 2) {
      return parts.slice(1).join(".");
    }
  }

  return "hubregional.com.br";
}

export function getBrowserHost() {
  if (typeof window === "undefined") return "";
  return normalizeHost(window.location.hostname);
}

export function normalizeSubdomain(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function getBrowserSubdomain() {
  if (typeof window === "undefined") return "";

  const host = getBrowserHost();
  const rootDomain = getBrowserRootDomain();
  if (host.endsWith(`.${rootDomain}`) && host !== `www.${rootDomain}` && host !== `admin.${rootDomain}`) {
    const subdomain = normalizeSubdomain(host.slice(0, -(rootDomain.length + 1)));
    if (subdomain) {
      localStorage.setItem("delivery:subdomain", subdomain);
      return subdomain;
    }
  }

  const fromQuery = normalizeSubdomain(new URLSearchParams(window.location.search).get("subdomain"));
  if (fromQuery) {
    localStorage.setItem("delivery:subdomain", fromQuery);
    return fromQuery;
  }

  return normalizeSubdomain(localStorage.getItem("delivery:subdomain"));
}

function buildHeaders(headers?: HeadersInit, options?: { json?: boolean; subdomain?: string | null; skipSubdomain?: boolean }) {
  const nextHeaders = new Headers(headers);
  const subdomain = options?.skipSubdomain ? "" : normalizeSubdomain(options?.subdomain) || getBrowserSubdomain();

  if (options?.json !== false && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }
  if (subdomain && !nextHeaders.has("x-company-subdomain")) {
    nextHeaders.set("x-company-subdomain", subdomain);
  }

  return nextHeaders;
}

export async function apiFetch(path: string, init?: RequestInit, options?: { json?: boolean; subdomain?: string | null; skipSubdomain?: boolean }) {
  const isAdminRequest = path.startsWith("/admin");
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.headers, {
      ...options,
      skipSubdomain: options?.skipSubdomain || isAdminRequest
    }),
    cache: init?.cache ?? "no-store"
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const method = init?.method?.toUpperCase() ?? "GET";
    const separator = path.includes("?") ? "&" : "?";
    const requestPath = method === "GET" ? `${path}${separator}_=${Date.now()}` : path;

    res = await apiFetch(requestPath, init);
  } catch {
    throw new Error("Servidor indisponivel. Aguarde alguns segundos e tente novamente.");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.message ?? "Erro na requisicao");
  }

  return res.json();
}

export function resolveAssetUrl(value?: string | null) {
  if (!value) return "";
  if (value.startsWith("/")) return value;

  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/api/marketplace/assets/")) {
      return url.pathname;
    }
  } catch {
    return value;
  }

  return value;
}

export { API_URL };
