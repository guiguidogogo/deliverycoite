"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { api, getBrowserSubdomain } from "../../lib/api";
import { LocationPicker } from "../../components/location-picker";

type Tab = "login" | "register";

export default function CustomerAuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");
  const [loading, setLoading] = useState(false);

  // Login form
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  // Register form
  const [registerName, setRegisterName] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerAddress, setRegisterAddress] = useState("");
  const [registerNumber, setRegisterNumber] = useState("");
  const [registerDistrict, setRegisterDistrict] = useState("");
  const [registerComplement, setRegisterComplement] = useState("");
  const [registerLat, setRegisterLat] = useState<number | undefined>();
  const [registerLng, setRegisterLng] = useState<number | undefined>();
  const [addressMode, setAddressMode] = useState<"MANUAL" | "LOCATION">("MANUAL");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api<{ token: string; customer: any }>("/customer/login", {
        method: "POST",
        body: JSON.stringify({
          phone: loginPhone,
          password: loginPassword,
          subdomain: getBrowserSubdomain() || undefined
        })
      });

      localStorage.setItem("delivery:customer-token", response.token);
      localStorage.setItem("delivery:customer", JSON.stringify(response.customer));
      toast.success(`Bem-vindo, ${response.customer.name}!`);
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api<{ token: string; customer: any }>("/customer/register", {
        method: "POST",
        body: JSON.stringify({
          name: registerName,
          phone: registerPhone,
          email: registerEmail || undefined,
          password: registerPassword,
          address: registerAddress || undefined,
          number: registerNumber || undefined,
          district: registerDistrict || undefined,
          complement: registerComplement || undefined,
          latitude: registerLat,
          longitude: registerLng,
          subdomain: getBrowserSubdomain() || undefined
        })
      });

      localStorage.setItem("delivery:customer-token", response.token);
      localStorage.setItem("delivery:customer", JSON.stringify(response.customer));
      toast.success("Cadastro realizado com sucesso!");
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  async function requestPasswordReset() {
    try {
      const response = await api<{ message: string }>("/customer/password/request", {
        method: "POST",
        body: JSON.stringify({ phone: loginPhone, subdomain: getBrowserSubdomain() || undefined })
      });
      setRecovering(true);
      toast.success(response.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar codigo");
    }
  }

  async function confirmPasswordReset() {
    try {
      await api("/customer/password/reset", {
        method: "POST",
        body: JSON.stringify({
          phone: loginPhone,
          code: resetCode,
          newPassword: resetPassword,
          subdomain: getBrowserSubdomain() || undefined
        })
      });
      setRecovering(false);
      setResetCode("");
      setResetPassword("");
      toast.success("Senha alterada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao redefinir senha");
    }
  }

  function getLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada");
      return;
    }

    toast.info("Obtendo sua localização...");
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setRegisterLat(position.coords.latitude);
        setRegisterLng(position.coords.longitude);

        // Tentar preencher endereço via geocoding reverso
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}`
          );
          const data = await response.json();
          
          if (data.address) {
            setRegisterAddress(data.address.road || "");
            setRegisterNumber(data.address.house_number || "");
            setRegisterDistrict(data.address.suburb || data.address.neighbourhood || "");
          }
          
          toast.success("Localização obtida!");
        } catch {
          toast.success("Localização obtida! Preencha o endereço manualmente.");
        }
      },
      () => {
        toast.error("Erro ao obter localização");
      }
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h1 className="font-display text-4xl">Minha Conta</h1>
        <p className="text-sm opacity-70">Faça login ou crie sua conta</p>

        <div className="mt-4 flex gap-2">
          <button
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "login"
                ? "bg-ink text-white dark:bg-ember"
                : "border border-black/10 dark:border-white/20"
            }`}
            onClick={() => setTab("login")}
          >
            Login
          </button>
          <button
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "register"
                ? "bg-ink text-white dark:bg-ember"
                : "border border-black/10 dark:border-white/20"
            }`}
            onClick={() => setTab("register")}
          >
            Cadastrar
          </button>
        </div>

        {tab === "login" ? (
          <form onSubmit={handleLogin} className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Telefone"
              value={loginPhone}
              onChange={(e) => setLoginPhone(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Senha"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            <button
              className="w-full rounded-xl bg-ink px-4 py-2 font-semibold text-white dark:bg-ember disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
            {!recovering ? (
              <button type="button" className="w-full text-sm underline" onClick={() => void requestPasswordReset()}>
                Esqueci minha senha
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border border-black/10 p-3 dark:border-white/20">
                <p className="text-sm">Digite o codigo recebido no WhatsApp.</p>
                <input className="w-full rounded-xl border px-3 py-2" placeholder="Código" value={resetCode} onChange={(e) => setResetCode(e.target.value)} />
                <input className="w-full rounded-xl border px-3 py-2" type="password" placeholder="Nova senha" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                <button type="button" className="w-full rounded-xl bg-ember px-3 py-2 text-white" onClick={() => void confirmPasswordReset()}>
                  Alterar senha
                </button>
              </div>
            )}
            <a href="/" className="block text-center text-sm text-ink dark:text-ember">
              Voltar para o cardápio
            </a>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Nome completo *"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Telefone *"
              value={registerPhone}
              onChange={(e) => setRegisterPhone(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Email *"
              type="email"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Senha *"
              type="password"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              required
              minLength={6}
            />

            <div className="rounded-xl border border-dashed border-ink/30 p-3 dark:border-ember/30">
              <button
                type="button"
                className={`mb-2 w-full rounded-lg px-2 py-2 text-xs font-semibold ${addressMode === "MANUAL" ? "bg-ink text-white dark:bg-ember" : "border"}`}
                onClick={() => {
                  setAddressMode("MANUAL");
                  setRegisterLat(undefined);
                  setRegisterLng(undefined);
                }}
              >
                Digitar endereco manualmente
              </button>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Endereço (opcional)</p>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1 text-xs text-white"
                  onClick={() => {
                    setAddressMode("LOCATION");
                    getLocation();
                  }}
                >
                  <MapPin size={14} />
                  Usar minha localização
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="col-span-2 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                  placeholder="Endereço"
                  value={registerAddress}
                  onChange={(e) => setRegisterAddress(e.target.value)}
                />
                <input
                  className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                  placeholder="Número"
                  value={registerNumber}
                  onChange={(e) => setRegisterNumber(e.target.value)}
                />
                <input
                  className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                  placeholder="Bairro"
                  value={registerDistrict}
                  onChange={(e) => setRegisterDistrict(e.target.value)}
                />
                <input
                  className="col-span-2 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                  placeholder="Complemento"
                  value={registerComplement}
                  onChange={(e) => setRegisterComplement(e.target.value)}
                />
              </div>
              {addressMode === "LOCATION" && registerLat !== undefined && registerLng !== undefined && (
                <div className="mt-3">
                  <LocationPicker
                    value={{ latitude: registerLat, longitude: registerLng }}
                    onChange={(location) => {
                      setRegisterLat(location.latitude);
                      setRegisterLng(location.longitude);
                    }}
                  />
                </div>
              )}
            </div>

            <button
              className="w-full rounded-xl bg-ink px-4 py-2 font-semibold text-white dark:bg-ember disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? "Criando conta..." : "Criar conta"}
            </button>
            <a href="/" className="block text-center text-sm text-ink dark:text-ember">
              Voltar para o cardápio
            </a>
          </form>
        )}
      </div>
    </main>
  );
}
