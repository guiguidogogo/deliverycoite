"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Plus, Trash2, Home, Briefcase } from "lucide-react";
import { api } from "../../lib/api";
import { LocationPicker } from "../../components/location-picker";
import { findAddressCoordinates } from "../../lib/geocoding";

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

type CustomerTicket = {
  id: string;
  total: number;
  paidAt?: string | null;
  paymentStatus?: string | null;
  event: {
    title: string;
    eventDate: string;
    startTime: string;
    location: string;
  };
  tickets: Array<{
    id: string;
    code: string;
    qrCode: string;
    status: string;
    ticketType: {
      name: string;
      audience?: string;
    };
  }>;
};

function qrImage(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(value)}`;
}

export default function ProfilePage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [activeTicket, setActiveTicket] = useState<CustomerTicket | null>(null);
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
  const [addressMode, setAddressMode] = useState<"MANUAL" | "LOCATION">("MANUAL");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

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
      setProfileName(profile.name);
      setProfilePhone(profile.phone);
      setProfileEmail(profile.email ?? "");
      setAddresses(profile.addresses);
      const ticketOrders = await api<CustomerTicket[]>("/customer/tickets", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTickets(ticketOrders);
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
      let latitude = newLat;
      let longitude = newLng;
      if (addressMode === "MANUAL" && latitude === undefined && longitude === undefined) {
        try {
          const location = await findAddressCoordinates(newAddress, newNumber, newDistrict);
          latitude = location.latitude;
          longitude = location.longitude;
        } catch {
          // O endereco manual continua podendo ser salvo sem coordenadas.
        }
      }

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
          latitude,
          longitude,
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
      setAddressMode("MANUAL");
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

  async function changePassword() {
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) return;
    try {
      await api("/customer/password", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Senha alterada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar senha");
    }
  }

  async function saveProfile() {
    const token = localStorage.getItem("delivery:customer-token");
    if (!token) return;
    try {
      const updated = await api<Customer>("/customer/profile", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: profileName,
          phone: profilePhone,
          email: profileEmail
        })
      });
      setCustomer((current) => current ? { ...current, ...updated } : updated);
      setProfileName(updated.name);
      setProfilePhone(updated.phone);
      setProfileEmail(updated.email ?? "");
      localStorage.setItem("delivery:customer", JSON.stringify(updated));
      toast.success("Perfil atualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar perfil");
    }
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
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input className="rounded-xl border px-3 py-2" placeholder="Nome" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
          <input className="rounded-xl border px-3 py-2" placeholder="Telefone" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} />
          <input className="rounded-xl border px-3 py-2 md:col-span-2" placeholder="Email" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
          <button className="rounded-xl bg-ink px-3 py-2 text-white md:col-span-2" onClick={() => void saveProfile()}>
            Salvar perfil
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Alterar senha</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button className="rounded-xl bg-ink px-3 py-2 text-white md:col-span-2" onClick={() => void changePassword()}>
            Alterar senha
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Meus ingressos</h2>
        <p className="mt-1 text-sm opacity-70">Aqui aparecem seus ingressos e QR Codes após o pagamento confirmado.</p>
        <div className="mt-4 space-y-3">
          {tickets.length ? tickets.map((order) => (
            <article key={order.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{order.event.title}</p>
                  <p className="text-xs opacity-70">{new Date(order.event.eventDate).toLocaleDateString("pt-BR")} • {order.event.startTime} • {order.event.location}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${order.paidAt ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
                  {order.paidAt ? "Pago" : order.paymentStatus || "Pendente"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {order.tickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => setActiveTicket(order)} className="rounded-lg bg-slate-50 p-3 text-left text-sm dark:bg-slate-800">
                    <strong>{ticket.ticketType.name}</strong>
                    <p className="mt-1 text-xs opacity-70">Código: {ticket.code}</p>
                    <p className="text-xs opacity-70">Toque para abrir o QR Code</p>
                  </button>
                ))}
              </div>
            </article>
          )) : <p className="rounded-xl bg-slate-50 p-3 text-sm opacity-70 dark:bg-slate-800">Nenhum ingresso encontrado ainda.</p>}
        </div>
      </section>

      {activeTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setActiveTicket(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 text-slate-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-600">Meu ingresso</p>
                <h3 className="mt-1 text-2xl font-black">{activeTicket.event.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{new Date(activeTicket.event.eventDate).toLocaleDateString("pt-BR")} • {activeTicket.event.startTime}</p>
              </div>
              <button type="button" className="rounded-full bg-slate-100 px-3 py-2 font-bold" onClick={() => setActiveTicket(null)}>Fechar</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[260px_1fr]">
              <img src={qrImage(activeTicket.tickets[0]?.qrCode ?? activeTicket.id)} alt="QR Code do ingresso" className="mx-auto h-[260px] w-[260px] rounded-2xl border bg-white p-3" />
              <div className="space-y-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Códigos</p>
                  <div className="mt-2 space-y-2">
                    {activeTicket.tickets.map((ticket) => (
                      <div key={ticket.id} className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
                        <strong>{ticket.ticketType.name}</strong>
                        <p className="text-xs text-slate-500">{ticket.code}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  {activeTicket.paidAt ? "Pagamento confirmado. Use este QR Code na entrada." : "Assim que o pagamento for confirmado, o QR Code ficará liberado aqui."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
                className={`w-full rounded-lg px-3 py-2 text-sm font-semibold ${addressMode === "MANUAL" ? "bg-ink text-white dark:bg-ember" : "border border-black/10 dark:border-white/20"}`}
                onClick={() => {
                  setAddressMode("MANUAL");
                  setNewLat(undefined);
                  setNewLng(undefined);
                }}
              >
                Digitar endereco manualmente
              </button>

              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm text-white"
                onClick={() => {
                  setAddressMode("LOCATION");
                  getLocationForNew();
                }}
              >
                <MapPin size={16} />
                Usar minha localização
              </button>

              {addressMode === "LOCATION" && newLat !== undefined && newLng !== undefined && (
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
