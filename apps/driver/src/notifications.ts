import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";

export const ROUTE_OFFER_CATEGORY = "route-offer";
export const ACCEPT_ROUTE_ACTION = "accept-route";
export const DECLINE_ROUTE_ACTION = "decline-route";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

export async function registerPushNotifications(
  onStatus?: (status: string) => void
) {
  if (!Device.isDevice) return null;
  onStatus?.("Preparando botoes da notificacao...");
  await Notifications.setNotificationCategoryAsync(ROUTE_OFFER_CATEGORY, [
    {
      identifier: ACCEPT_ROUTE_ACTION,
      buttonTitle: "Aceitar",
      options: { opensAppToForeground: true }
    },
    {
      identifier: DECLINE_ROUTE_ACTION,
      buttonTitle: "Recusar",
      options: { opensAppToForeground: true, isDestructive: true }
    }
  ]);
  if (Platform.OS === "android") {
    onStatus?.("Configurando som de alerta...");
    await Notifications.setNotificationChannelAsync("delivery-routes", {
      name: "Novas rotas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default"
    });
  }
  onStatus?.("Verificando permissao de notificacao...");
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted"
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return null;

  const projectId = Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error("Execute eas init para configurar o projectId das notificacoes");
  }
  if (!Constants.expoConfig?.extra?.firebaseConfigured) {
    throw new Error("FIREBASE_NOT_CONFIGURED");
  }
  onStatus?.("Conectando o aparelho ao Firebase...");
  await withTimeout(
    Notifications.getDevicePushTokenAsync(),
    15000,
    "O Firebase nao respondeu. Verifique a internet e tente novamente."
  );
  onStatus?.("Gerando token de notificacao...");
  const token = (await withTimeout(
    Notifications.getExpoPushTokenAsync({ projectId }),
    15000,
    "A Expo nao conseguiu gerar o token. Tente novamente."
  )).data;
  onStatus?.("Registrando aparelho no servidor...");
  await withTimeout(api("/driver/device-token", {
    method: "POST",
    body: JSON.stringify({ expoToken: token, platform: Platform.OS })
  }), 15000, "O servidor nao conseguiu registrar este aparelho.");
  return token;
}
