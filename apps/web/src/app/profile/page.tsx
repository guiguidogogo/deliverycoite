"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Plus, Trash2, Home, Briefcase } from "lucide-react";
import { api } from "../../lib/api";
import { LocationPicker } from "../../components/location-picker";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
};

type Address = {
  id: string;
  label: string;
  address: string;
  number: string;
  district: string;
  complement?: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
};

export default function ProfilePage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAddress, setShowAddAddress] = useState(false);

  // Novo endereço
  const [newLabel, setNewLabel] = useState("Casa");
  const [newAddress, setNewAddress] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newDistrict, setNewDistrict] = useState("");
  const [newComplement, setNewComplement] = useState("");
  const [newLat, setNewLat] = useState<number | undefined>();
  const [newLng, setNewLng] = useState<number | undefined>();
  const [newIsDefault, setNewIsDefault] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) {
      router.push("/account");
      return;
    }

    loadProfile(token);
  }, [router]);

  async function loadProfile(token: string) {
    try {
      const profile = await api<{ id: string; name: string; phone: string; email?: string; addresses: Address[] }>(
        "/customer/profile",
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setCustomer({
        id: profile.id,
        name: profile.name,
        phone: profile.phone,
        email: profile.email
      });
      setAddresses(profile.addresses);
    } catch (error) {
      toast.error("Erro ao carregar perfil");
      router.push("/account");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAddress(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) return;

    try {
      const newAddr = await api<Address>("/customer/addresses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          label: newLabel,
          address: newAddress,
          number: newNumber,
          district: newDistrict,
          complement: newComplement || undefined,
          latitude: newLat,
          longitude: newLng,
          isDefault: newIsDefault
        })
      });

      setAddresses((prev) => [...prev, newAddr]);
      setShowAddAddress(false);
      setNewLabel("Casa");
      setNewAddress("");
      setNewNumber("");
      setNewDistrict("");
      setNewComplement("");
      setNewLat(undefined);
      setNewLng(undefined);
      setNewIsDefault(false);
      toast.success("Endereço adicionado!");
    } catch (error) {
      toast.error("Erro ao adicionar endereço");
    }
  }

  async function handleDeleteAddress(id: string) {
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) return;

    try {
      await api(`/customer/addresses/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      setAddresses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Endereço removido!");
    } catch (error) {
      toast.error("Erro ao remover endereço");
    }
  }

  async function handleSetDefault(id: string) {
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) return;

    try {
      await api<Address>(`/customer/addresses/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isDefault: true })
      });

      setAddresses((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
      toast.success("Endereço padrão atualizado!");
    } catch (error) {
      toast.error("Erro ao atualizar endereço");
    }
  }

  function getLocationForNew() {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada");
      return;
    }

    toast.info("Obtendo sua localização...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setNewLat(position.coords.latitude);
        setNewLng(position.coords.longitude);

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}`
          );
          const data = await response.json();

          if (data.address) {
            setNewAddress(data.address.road || "");
            setNewNumber(data.address.house_number || "");
            setNewDistrict(data.address.suburb || data.address.neighbourhood || "");
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

  function handleLogout() {
    localStorage.removeItem("delivery:customer-token");
    localStorage.removeItem("delivery:customer");
    router.push("/");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Carregando...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-4xl">Meu Perfil</h1>
        <div className="flex gap-2">
          <a href="/" className="rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/20">
            Cardápio
          </a>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-red-500 px-3 py-2 text-sm text-white"
          >
            Sair
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Dados Pessoais</h2>
        <div className="mt-3 space-y-2">
          <p>
            <strong>Nome:</strong> {customer?.name}
          </p>
          <p>
            <strong>Telefone:</strong> {customer?.phone}
          </p>
          {customer?.email && (
            <p>
              <strong>Email:</strong> {customer.email}
            </p>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Meus Endereços</h2>
          <button
            onClick={() => setShowAddAddress(true)}
            className="flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-sm text-white dark:bg-ember"
          >
            <Plus size={16} />
            Adicionar
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className={`rounded-xl border p-3 ${
                addr.isDefault ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-black/10 dark:border-white/10"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {addr.label === "Casa" ? <Home size={18} /> : addr.label === "Trabalho" ? <Briefcase size={18} /> : <MapPin size={18} />}
                  <div>
                    <p className="font-semibold">{addr.label}</p>
                    <p className="text-sm">
                      {addr.address}, {addr.number} - {addr.district}
                    </p>
                    {addr.complement && <p className="text-xs opacity-70">{addr.complement}</p>}
                  </div>
                </div>
                <button onClick={() => handleDeleteAddress(addr.id)} className="text-red-500">
                  <Trash2 size={18} />
                </button>
              </div>
              {!addr.isDefault && (
                <button
                  onClick={() => handleSetDefault(addr.id)}
                  className="mt-2 text-xs text-ink underline dark:text-ember"
                >
                  Definir como padrão
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {showAddAddress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddAddress(false)}>
          <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold">Novo Endereço</h2>
            <form onSubmit={handleAddAddress} className="mt-4 space-y-3">
              <select
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                required
              >
                <option value="Casa">Casa</option>
                <option value="Trabalho">Trabalho</option>
                <option value="Outro">Outro</option>
              </select>

              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm text-white"
                onClick={getLocationForNew}
              >
                <MapPin size={16} />
                Usar minha localização
              </button>

              {newLat !== undefined && newLng !== undefined && (
                <LocationPicker
                  value={{ latitude: newLat, longitude: newLng }}
                  onChange={(location) => {
                    setNewLat(location.latitude);
                    setNewLng(location.longitude);
                  }}
                  height={220}
                />
              )}

              <input
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                placeholder="Endereço *"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                  placeholder="Número *"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  required
                />
                <input
                  className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                  placeholder="Bairro *"
                  value={newDistrict}
                  onChange={(e) => setNewDistrict(e.target.value)}
                  required
                />
              </div>
              <input
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                placeholder="Complemento"
                value={newComplement}
                onChange={(e) => setNewComplement(e.target.value)}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                />
                Definir como endereço padrão
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddAddress(false)}
                  className="flex-1 rounded-xl border border-black/10 px-4 py-2 dark:border-white/20"
                >
                  Cancelar
                </button>
                <button type="submit" className="flex-1 rounded-xl bg-ink px-4 py-2 text-white dark:bg-ember">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
