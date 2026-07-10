import { apiFetch } from "./api";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "ATTENDANT";
  scope: "GLOBAL" | "COMPANY";
  permissions: string[];
};

export function getAdminToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("delivery:token");
}

export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new Error("Sessao expirada");
  const response = await apiFetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  }, { skipSubdomain: true });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    throw new Error(payload.message ?? "Erro na requisicao");
  }
  if (response.status === 204) return undefined as T;
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trim() || "Resposta invalida da API");
  }
  return response.json();
}

export async function requireMaster() {
  const me = await adminApi<AdminUser>("/admin/me");
  if (me.role !== "SUPER_ADMIN") throw new Error("Acesso exclusivo do administrador master");
  return me;
}
