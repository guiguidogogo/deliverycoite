import { apiFetch, readApiJson } from "./api";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "ATTENDANT";
  scope: "GLOBAL" | "COMPANY";
  permissions: string[];
  company?: {
    id: string;
    tradeName: string;
    subdomain: string;
    active: boolean;
    businessType?: string;
    category?: string | null;
  } | null;
};

export function getAdminToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("delivery:token");
}

type ApiIssue = {
  message?: string;
  path?: Array<string | number>;
};

type ApiErrorPayload = {
  message?: string;
  issues?: ApiIssue[];
};

const apiFieldLabels: Record<string, string> = {
  title: "Titulo",
  description: "Descricao",
  imageUrl: "Imagem",
  videoUrls: "Videos",
  numberStart: "Numero inicial",
  numberEnd: "Numero final",
  numberDigits: "Digitos",
  pricePerNumber: "Valor por numero",
  minimumQuantity: "Minimo por compra",
  maximumQuantity: "Maximo por compra",
  reservationMinutes: "Tempo de reserva",
  drawEnabled: "Apuracao automatica",
  drawLotteryModality: "Modalidade",
  drawContestNumber: "Concurso",
  drawScheduledAt: "Data/hora prevista",
  status: "Status"
};

function formatApiError(payload: ApiErrorPayload) {
  const issue = payload.issues?.[0];
  if (issue?.message) {
    const fieldKey = Array.isArray(issue.path) ? String(issue.path[0] ?? "") : "";
    const label = apiFieldLabels[fieldKey];
    return label ? `${label}: ${issue.message}` : issue.message;
  }
  if (payload.message && payload.message !== "Erro de validacao") return payload.message;
  return "Nao foi possivel salvar. Revise os campos destacados e tente novamente.";
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
      ? await readApiJson<ApiErrorPayload>(response).catch(() => ({}))
      : {};
    throw new Error(formatApiError(payload));
  }
  if (response.status === 204) return undefined as T;
  return readApiJson<T>(response);
}

export async function requireMaster() {
  const me = await adminApi<AdminUser>("/admin/me");
  if (me.role !== "SUPER_ADMIN") throw new Error("Acesso exclusivo do administrador master");
  return me;
}
