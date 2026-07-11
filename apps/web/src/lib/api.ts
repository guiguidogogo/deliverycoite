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

function getCurrentHostSubdomain() {
  if (typeof window === "undefined") return "";

  const host = normalizeHost(window.location.hostname);
  const rootDomain = getBrowserRootDomain();
  if (host.endsWith(`.${rootDomain}`) && host !== rootDomain && host !== `www.${rootDomain}` && host !== `admin.${rootDomain}`) {
    return normalizeSubdomain(host.slice(0, -(rootDomain.length + 1)));
  }

  const fromQuery = normalizeSubdomain(new URLSearchParams(window.location.search).get("subdomain"));
  return fromQuery;
}

function looksLikeCoolifyGeneratedHost(value: string) {
  return /^[a-z0-9]{16,}$/i.test(value);
}

function getStoredSubdomain() {
  if (typeof window === "undefined") return "";
  return normalizeSubdomain(localStorage.getItem("delivery:subdomain"));
}

export function getBrowserRootDomain() {
  if (typeof window === "undefined") return "hubregional.com.br";

  const host = normalizeHost(window.location.hostname);
  if (host.endsWith(".sslip.io")) {
    const parts = host.split(".");
    if (parts.length > 2) {
      return parts.slice(1).join(".");
    }
  }

  if (CONFIGURED_ROOT_DOMAIN) return CONFIGURED_ROOT_DOMAIN;

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

  const currentHostSubdomain = getCurrentHostSubdomain();
  if (currentHostSubdomain) {
    if (looksLikeCoolifyGeneratedHost(currentHostSubdomain)) {
      return getStoredSubdomain();
    }
    localStorage.setItem("delivery:subdomain", currentHostSubdomain);
    return currentHostSubdomain;
  }

  return getStoredSubdomain();
}

function buildHeaders(
  headers?: HeadersInit,
  options?: { json?: boolean; subdomain?: string | null; skipSubdomain?: boolean; preferCurrentHostSubdomain?: boolean }
) {
  const nextHeaders = new Headers(headers);
  const currentHostSubdomain = getCurrentHostSubdomain();
  const storedSubdomain = getStoredSubdomain();
  const subdomain = options?.skipSubdomain
    ? ""
    : normalizeSubdomain(options?.subdomain)
      || (
        options?.preferCurrentHostSubdomain
          ? (
            currentHostSubdomain && !looksLikeCoolifyGeneratedHost(currentHostSubdomain)
              ? currentHostSubdomain
              : storedSubdomain || currentHostSubdomain
          )
          : getBrowserSubdomain()
      );

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
      skipSubdomain: options?.skipSubdomain,
      preferCurrentHostSubdomain: isAdminRequest
    }),
    cache: init?.cache ?? "no-store"
  });
}

export async function readApiJson<T = unknown>(
  response: Response,
  fallbackMessage = "Resposta invalida da API"
): Promise<T> {
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");

  if (!contentType.includes("application/json")) {
    const cleanText = text.trim();
    throw new Error(cleanText && cleanText.length < 180 ? cleanText : fallbackMessage);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
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

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const payload: { message?: string } = contentType.includes("application/json")
      ? await readApiJson<{ message?: string }>(res).catch(() => ({}))
      : {};
    throw new Error(payload.message ?? "Erro na requisicao");
  }

  return readApiJson<T>(res);
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
