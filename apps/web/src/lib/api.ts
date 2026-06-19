const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const method = init?.method?.toUpperCase() ?? "GET";
    const separator = path.includes("?") ? "&" : "?";
    const requestPath = method === "GET" ? `${path}${separator}_=${Date.now()}` : path;

    const browserSubdomain =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("subdomain")
          || localStorage.getItem("delivery:subdomain")
        : null;
    if (browserSubdomain && typeof window !== "undefined") {
      localStorage.setItem("delivery:subdomain", browserSubdomain);
    }

    res = await fetch(`${API_URL}${requestPath}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(browserSubdomain ? { "x-company-subdomain": browserSubdomain } : {}),
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
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
