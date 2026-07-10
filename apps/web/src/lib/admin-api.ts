import { apiFetch, readApiJson } from "./api";

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
    const payload: { message?: string } = contentType.includes("application/json")
      ? await readApiJson<{ message?: string }>(response).catch(() => ({}))
      : {};
    throw new Error(payload.message ?? "Erro na requisicao");
  }
  if (response.status === 204) return undefined as T;
  return readApiJson<T>(response);
}

export async function requireMaster() {
  const me = await adminApi<AdminUser>("/admin/me");
  if (me.role !== "SUPER_ADMIN") throw new Error("Acesso exclusivo do administrador master");
  return me;
}
