const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

export function normalizeSubdomain(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function getBrowserSubdomain() {
  if (typeof window === "undefined") return "";

  const fromQuery = normalizeSubdomain(new URLSearchParams(window.location.search).get("subdomain"));
  if (fromQuery) {
    localStorage.setItem("delivery:subdomain", fromQuery);
    return fromQuery;
  }

  return normalizeSubdomain(localStorage.getItem("delivery:subdomain"));
}

function buildHeaders(headers?: HeadersInit, options?: { json?: boolean; subdomain?: string | null }) {
  const nextHeaders = new Headers(headers);
  const subdomain = normalizeSubdomain(options?.subdomain) || getBrowserSubdomain();

  if (options?.json !== false && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }
  if (subdomain && !nextHeaders.has("x-company-subdomain")) {
    nextHeaders.set("x-company-subdomain", subdomain);
  }

  return nextHeaders;
}

export async function apiFetch(path: string, init?: RequestInit, options?: { json?: boolean; subdomain?: string | null }) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.headers, options),
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

export { API_URL };
