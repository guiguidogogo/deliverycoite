import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://deliverycoite-homolog.onrender.com/api";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await AsyncStorage.getItem("driver:token");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Falha na comunicacao com o servidor");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
