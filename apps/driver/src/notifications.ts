import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";

export const ROUTE_OFFER_CATEGORY = "route-offer";
export const ACCEPT_ROUTE_ACTION = "accept-route";
export const DECLINE_ROUTE_ACTION = "decline-route";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

export async function registerPushNotifications() {
  if (!Device.isDevice) return null;
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
    await Notifications.setNotificationChannelAsync("delivery-routes", {
      name: "Novas rotas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default"
    });
  }
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
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api("/driver/device-token", {
    method: "POST",
    body: JSON.stringify({ expoToken: token, platform: Platform.OS })
  });
  return token;
}
