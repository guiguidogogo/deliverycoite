import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { api } from "./src/api";
import { registerPushNotifications } from "./src/notifications";
import type { DeliveryRoute, Driver } from "./src/types";

type Screen = "routes" | "history" | "route";

function routeCode(number: number) {
  return `#${String(number).padStart(5, "0")}`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
  const [history, setHistory] = useState<DeliveryRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<DeliveryRoute | null>(null);
  const [screen, setScreen] = useState<Screen>("routes");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [login, setLogin] = useState({ phone: "", password: "", subdomain: "" });
  const [notificationStatus, setNotificationStatus] = useState("Configurando notificacoes...");
  const knownRouteIdsRef = useRef<Set<string>>(new Set());
  const routesInitializedRef = useRef(false);

  const loadSession = useCallback(async () => {
    const stored = await AsyncStorage.getItem("driver:token");
    setToken(stored);
    setLoading(false);
  }, []);

  const loadData = useCallback(async (notifyNewRoutes = false) => {
    const [profile, activeRoutes, historicRoutes] = await Promise.all([
      api<Driver>("/driver/me"),
      api<DeliveryRoute[]>("/driver/routes"),
      api<DeliveryRoute[]>("/driver/routes?history=true")
    ]);
    const newRoutes = activeRoutes.filter(
      (route) => route.status === "CREATED" && !knownRouteIdsRef.current.has(route.id)
    );
    if (notifyNewRoutes && routesInitializedRef.current) {
      await Promise.all(newRoutes.map((route) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: "Nova rota de entrega",
            body: `Voce recebeu uma nova rota com ${route.orders.length} pedido(s).`,
            sound: "default",
            data: { routeId: route.id, screen: "route" }
          },
          trigger: null
        })
      ));
    }
    knownRouteIdsRef.current = new Set(activeRoutes.map((route) => route.id));
    routesInitializedRef.current = true;
    setDriver(profile);
    setRoutes(activeRoutes);
    setHistory(historicRoutes);
    setSelectedRoute((current) =>
      current
        ? [...activeRoutes, ...historicRoutes].find((route) => route.id === current.id) ?? current
        : current
    );
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!token) return;
    void loadData().catch((error) => Alert.alert("Erro", error.message));
    void registerPushNotifications()
      .then((pushToken) => setNotificationStatus(
        pushToken ? "Push e som ativados" : "Push indisponivel neste aparelho"
      ))
      .catch((error) => {
        const firebaseMissing =
          error instanceof Error
          && (
            error.message === "FIREBASE_NOT_CONFIGURED"
            || error.message.includes("Firebase Messaging")
            || error.message.includes("FirebaseApp")
          );
        setNotificationStatus(
          firebaseMissing
            ? "Alerta automatico local ativo. Push remoto aguardando configuracao Firebase."
            : "Alerta automatico local ativo. Push remoto indisponivel."
        );
      });
  }, [token, loadData]);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      void loadData(true).catch(() => undefined);
    }, 5000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadData(true).catch(() => undefined);
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [token, loadData]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const routeId = notification.request.content.data?.routeId;
      if (typeof routeId === "string") knownRouteIdsRef.current.add(routeId);
      if (token) void loadData(false).catch(() => undefined);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const routeId = response.notification.request.content.data?.routeId;
      if (typeof routeId !== "string") return;
      void api<DeliveryRoute>(`/driver/routes/${routeId}`)
        .then((route) => {
          setSelectedRoute(route);
          setScreen("route");
        })
        .catch(() => undefined);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const routeId = response?.notification.request.content.data?.routeId;
      if (typeof routeId !== "string" || !token) return;
      void api<DeliveryRoute>(`/driver/routes/${routeId}`).then((route) => {
        setSelectedRoute(route);
        setScreen("route");
      }).catch(() => undefined);
    });
    return () => {
      received.remove();
      subscription.remove();
    };
  }, [token, loadData]);

  useEffect(() => {
    if (!token || !driver?.available) return;
    let subscription: Location.LocationSubscription | null = null;
    void Location.requestForegroundPermissionsAsync().then(async (permission) => {
      if (permission.status !== "granted") return;
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30000,
          distanceInterval: 100
        },
        (position) => {
          void api("/driver/location", {
            method: "PATCH",
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            })
          });
        }
      );
    });
    return () => subscription?.remove();
  }, [token, driver?.available]);

  async function submitLogin() {
    setLoading(true);
    try {
      const payload = await api<{ token: string; driver: Driver }>("/driver/auth/login", {
        method: "POST",
        body: JSON.stringify(login)
      });
      await AsyncStorage.setItem("driver:token", payload.token);
      setToken(payload.token);
      setDriver(payload.driver);
    } catch (error) {
      Alert.alert("Nao foi possivel entrar", error instanceof Error ? error.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await AsyncStorage.removeItem("driver:token");
    setToken(null);
    setDriver(null);
    setRoutes([]);
    setHistory([]);
    setSelectedRoute(null);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await loadData();
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Falha ao atualizar");
    } finally {
      setRefreshing(false);
    }
  }

  async function setAvailability(available: boolean) {
    try {
      await api("/driver/availability", {
        method: "PATCH",
        body: JSON.stringify({ available })
      });
      setDriver((current) => current ? { ...current, available } : current);
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Falha");
    }
  }

  async function routeAction(action: "accept" | "decline" | "complete") {
    if (!selectedRoute) return;
    try {
      await api(`/driver/routes/${selectedRoute.id}/${action}`, { method: "POST" });
      await refresh();
      if (action === "decline" || action === "complete") {
        setSelectedRoute(null);
        setScreen("routes");
      }
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Falha");
    }
  }

  async function markDelivered(orderId: string) {
    if (!selectedRoute) return;
    try {
      await api(`/driver/routes/${selectedRoute.id}/orders/${orderId}/delivered`, {
        method: "PATCH"
      });
      const route = await api<DeliveryRoute>(`/driver/routes/${selectedRoute.id}`);
      setSelectedRoute(route);
      await loadData();
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Falha");
    }
  }

  async function startGoogleNavigation() {
    if (!selectedRoute) return;
    const nativeIntent = selectedRoute.androidNavigationIntent;
    if (Platform.OS === "android" && nativeIntent) {
      try {
        await Linking.openURL(nativeIntent);
        return;
      } catch {
        // O link universal abaixo funciona quando o app Google Maps nao aceita o intent.
      }
    }
    await Linking.openURL(selectedRoute.navigationUrl ?? selectedRoute.googleMapsUrl);
  }

  const finalStop = useMemo(
    () => selectedRoute?.orders[selectedRoute.orders.length - 1],
    [selectedRoute]
  );

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#e76f51" /></SafeAreaView>;
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.loginPage}>
        <StatusBar style="dark" />
        <View style={styles.loginCard}>
          <Text style={styles.brand}>HubRegional</Text>
          <Text style={styles.title}>App do Motoboy</Text>
          <TextInput style={styles.input} placeholder="Telefone" keyboardType="phone-pad" value={login.phone} onChangeText={(phone) => setLogin((current) => ({ ...current, phone }))} />
          <TextInput style={styles.input} placeholder="Senha" secureTextEntry value={login.password} onChangeText={(password) => setLogin((current) => ({ ...current, password }))} />
          <TextInput style={styles.input} placeholder="Subdominio da empresa" autoCapitalize="none" value={login.subdomain} onChangeText={(subdomain) => setLogin((current) => ({ ...current, subdomain }))} />
          <Pressable style={styles.primaryButton} onPress={() => void submitLogin()}>
            <Text style={styles.primaryButtonText}>Entrar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === "route" && selectedRoute) {
    return (
      <SafeAreaView style={styles.page}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para a lista de rotas"
            hitSlop={10}
            style={styles.backButton}
            onPress={() => setScreen("routes")}
          >
            <Text style={styles.backButtonText}>← Voltar para rotas</Text>
          </Pressable>
          <Text style={styles.title}>Detalhes da rota</Text>
          <Text style={styles.muted}>{selectedRoute.orders.length} entrega(s)</Text>
          {selectedRoute.status === "CREATED" && (
            <View style={styles.row}>
              <Pressable style={styles.acceptButton} onPress={() => void routeAction("accept")}><Text style={styles.buttonText}>Aceitar corrida</Text></Pressable>
              <Pressable style={styles.declineButton} onPress={() => void routeAction("decline")}><Text style={styles.buttonText}>Recusar</Text></Pressable>
            </View>
          )}
          <View style={styles.row}>
            <Pressable
              style={styles.mapsButton}
              onPress={() => void startGoogleNavigation()}
            >
              <Text style={styles.buttonText}>Iniciar no Google Maps</Text>
            </Pressable>
            <Pressable style={styles.wazeButton} onPress={() => {
              if (!finalStop) return;
              const query = finalStop.latitude != null && finalStop.longitude != null
                ? `${finalStop.latitude},${finalStop.longitude}`
                : finalStop.address;
              void Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`);
            }}><Text style={styles.buttonText}>Waze</Text></Pressable>
          </View>
          {selectedRoute.orders.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.sequence}. Pedido {routeCode(item.order.orderNumber)}</Text>
              <Text style={styles.customer}>{item.order.customer.name}</Text>
              <Text>{item.address}</Text>
              <Pressable onPress={() => void Linking.openURL(`tel:${item.order.customer.phone}`)}><Text style={styles.link}>Ligar: {item.order.customer.phone}</Text></Pressable>
              {item.order.customerNotes ? <Text style={styles.note}>Observacao: {item.order.customerNotes}</Text> : null}
              {item.order.items.map((product) => (
                <Text key={product.id} style={styles.item}>{product.quantity}x {product.product.name}</Text>
              ))}
              {selectedRoute.status === "IN_PROGRESS" && item.order.status !== "DELIVERED" && (
                <Pressable style={styles.deliveredButton} onPress={() => void markDelivered(item.order.id)}>
                  <Text style={styles.buttonText}>Marcar como entregue</Text>
                </Pressable>
              )}
              {item.order.status === "DELIVERED" && <Text style={styles.deliveredText}>Entregue</Text>}
            </View>
          ))}
          {selectedRoute.status === "IN_PROGRESS" && (
            <Pressable style={styles.primaryButton} onPress={() => void routeAction("complete")}>
              <Text style={styles.primaryButtonText}>Concluir rota</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const visibleRoutes = screen === "history" ? history : routes;
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{driver?.company.tradeName}</Text>
            <Text style={styles.title}>Ola, {driver?.name}</Text>
          </View>
          <Pressable onPress={() => void logout()}><Text style={styles.link}>Sair</Text></Pressable>
        </View>
        <View style={styles.availability}>
          <View><Text style={styles.cardTitle}>Status</Text><Text style={styles.muted}>{driver?.available ? "Disponivel para corridas" : "Indisponivel"}</Text></View>
          <Switch value={Boolean(driver?.available)} onValueChange={(value) => void setAvailability(value)} />
        </View>
        <Text style={styles.notificationStatus}>{notificationStatus}</Text>
        <View style={styles.tabs}>
          <Pressable style={screen === "routes" ? styles.activeTab : styles.tab} onPress={() => setScreen("routes")}><Text>Rotas</Text></Pressable>
          <Pressable style={screen === "history" ? styles.activeTab : styles.tab} onPress={() => setScreen("history")}><Text>Historico</Text></Pressable>
        </View>
        {!visibleRoutes.length && <Text style={styles.empty}>Nenhuma rota encontrada.</Text>}
        {visibleRoutes.map((route) => (
          <Pressable key={route.id} style={styles.card} onPress={() => { setSelectedRoute(route); setScreen("route"); }}>
            <Text style={styles.cardTitle}>{route.status === "CREATED" ? "Nova corrida" : "Rota de entrega"}</Text>
            <Text>{route.orders.length} pedido(s)</Text>
            <Text style={styles.muted}>{new Date(route.createdAt).toLocaleString("pt-BR")}</Text>
            <Text style={styles.link}>Ver detalhes</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? 28 : 0,
    backgroundColor: "#f5f3ea"
  },
  loginPage: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    paddingTop: Platform.OS === "android" ? 40 : 20,
    backgroundColor: "#f5f3ea"
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 14 },
  loginCard: { backgroundColor: "#fff", padding: 22, borderRadius: 22, gap: 12 },
  brand: { color: "#e76f51", fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.5 },
  title: { fontSize: 28, fontWeight: "800", color: "#14213d" },
  input: { borderWidth: 1, borderColor: "#d7d7d7", borderRadius: 12, padding: 14, backgroundColor: "#fff" },
  primaryButton: { backgroundColor: "#e76f51", borderRadius: 12, padding: 15, alignItems: "center", marginTop: 6 },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  buttonText: { color: "#fff", fontWeight: "700" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  availability: { backgroundColor: "#fff", padding: 16, borderRadius: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { padding: 12, flex: 1, alignItems: "center", borderRadius: 12, backgroundColor: "#fff" },
  activeTab: { padding: 12, flex: 1, alignItems: "center", borderRadius: 12, backgroundColor: "#7ebc59" },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 7 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: "#14213d" },
  customer: { fontSize: 18, fontWeight: "700" },
  muted: { color: "#64748b" },
  link: { color: "#2563eb", fontWeight: "700", marginTop: 4 },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 48,
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#14213d",
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  backButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  note: { backgroundColor: "#fff7ed", padding: 10, borderRadius: 8 },
  item: { color: "#475569" },
  row: { flexDirection: "row", gap: 10 },
  acceptButton: { flex: 1, backgroundColor: "#16a34a", padding: 14, borderRadius: 12, alignItems: "center" },
  declineButton: { flex: 1, backgroundColor: "#dc2626", padding: 14, borderRadius: 12, alignItems: "center" },
  mapsButton: { flex: 1, backgroundColor: "#2563eb", padding: 14, borderRadius: 12, alignItems: "center" },
  wazeButton: { flex: 1, backgroundColor: "#0ea5e9", padding: 14, borderRadius: 12, alignItems: "center" },
  deliveredButton: { backgroundColor: "#16a34a", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 6 },
  deliveredText: { color: "#16a34a", fontWeight: "800" },
  empty: { textAlign: "center", padding: 30, color: "#64748b" },
  notificationStatus: { color: "#475569", fontSize: 12, textAlign: "center" }
});
