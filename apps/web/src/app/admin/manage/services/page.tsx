"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";

type Service = {
  id: string;
  name: string;
  description?: string | null;
  durationMin: number;
  price: number;
  active: boolean;
  popular: boolean;
};

type Professional = {
  id: string;
  name: string;
  specialty: string;
  avatarUrl?: string | null;
  bio?: string | null;
  rating: number;
  active: boolean;
};

type Appointment = {
  id: string;
  customerName: string;
  customerPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  status: string;
  total: number;
  service: { name: string };
  professional?: { name: string } | null;
};

function token() {
  return typeof window === "undefined" ? "" : localStorage.getItem("delivery:token") || "";
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "Erro na API");
  return payload;
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [serviceForm, setServiceForm] = useState({ name: "", description: "", durationMin: "30", price: "0", popular: false, active: true });
  const [professionalForm, setProfessionalForm] = useState({ name: "", specialty: "", avatarUrl: "", bio: "", rating: "5", active: true });

  async function load() {
    try {
      const payload = await adminRequest<{ services: Service[]; professionals: Professional[]; appointments: Appointment[] }>("/admin/services");
      setServices(payload.services);
      setProfessionals(payload.professionals);
      setAppointments(payload.appointments);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar servicos");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveService(event: React.FormEvent) {
    event.preventDefault();
    try {
      await adminRequest("/admin/services", {
        method: "POST",
        body: JSON.stringify({
          ...serviceForm,
          durationMin: Number(serviceForm.durationMin),
          price: Number(serviceForm.price)
        })
      });
      setServiceForm({ name: "", description: "", durationMin: "30", price: "0", popular: false, active: true });
      toast.success("Servico criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar servico");
    }
  }

  async function saveProfessional(event: React.FormEvent) {
    event.preventDefault();
    try {
      await adminRequest("/admin/professionals", {
        method: "POST",
        body: JSON.stringify({
          ...professionalForm,
          rating: Number(professionalForm.rating)
        })
      });
      setProfessionalForm({ name: "", specialty: "", avatarUrl: "", bio: "", rating: "5", active: true });
      toast.success("Profissional criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar profissional");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.35em] text-amber-600">Servicos</p>
          <h1 className="font-display text-4xl">Barbearia e Salao</h1>
        </div>
        <a className="rounded-xl bg-ink px-4 py-2 text-white" href="/admin">Voltar</a>
      </div>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <form className="rounded-3xl border bg-white p-5 shadow-sm" onSubmit={saveService}>
          <h2 className="text-xl font-black">Novo servico</h2>
          <div className="mt-4 grid gap-3">
            <input className="input" placeholder="Nome" value={serviceForm.name} onChange={(event) => setServiceForm((value) => ({ ...value, name: event.target.value }))} />
            <textarea className="input min-h-24" placeholder="Descricao" value={serviceForm.description} onChange={(event) => setServiceForm((value) => ({ ...value, description: event.target.value }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <input className="input" type="number" min="5" placeholder="Duracao (min)" value={serviceForm.durationMin} onChange={(event) => setServiceForm((value) => ({ ...value, durationMin: event.target.value }))} />
              <input className="input" type="number" min="0" step="0.01" placeholder="Preco" value={serviceForm.price} onChange={(event) => setServiceForm((value) => ({ ...value, price: event.target.value }))} />
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={serviceForm.popular} onChange={(event) => setServiceForm((value) => ({ ...value, popular: event.target.checked }))} /> Popular</label>
            <button className="rounded-2xl bg-amber-600 px-4 py-3 font-black text-white">Salvar servico</button>
          </div>
        </form>

        <form className="rounded-3xl border bg-white p-5 shadow-sm" onSubmit={saveProfessional}>
          <h2 className="text-xl font-black">Novo profissional</h2>
          <div className="mt-4 grid gap-3">
            <input className="input" placeholder="Nome" value={professionalForm.name} onChange={(event) => setProfessionalForm((value) => ({ ...value, name: event.target.value }))} />
            <input className="input" placeholder="Especialidade" value={professionalForm.specialty} onChange={(event) => setProfessionalForm((value) => ({ ...value, specialty: event.target.value }))} />
            <input className="input" placeholder="Avatar URL" value={professionalForm.avatarUrl} onChange={(event) => setProfessionalForm((value) => ({ ...value, avatarUrl: event.target.value }))} />
            <textarea className="input min-h-24" placeholder="Bio" value={professionalForm.bio} onChange={(event) => setProfessionalForm((value) => ({ ...value, bio: event.target.value }))} />
            <input className="input" type="number" min="0" max="5" step="0.1" placeholder="Nota" value={professionalForm.rating} onChange={(event) => setProfessionalForm((value) => ({ ...value, rating: event.target.value }))} />
            <button className="rounded-2xl bg-amber-600 px-4 py-3 font-black text-white">Salvar profissional</button>
          </div>
        </form>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Servicos cadastrados</h2>
          <div className="mt-4 space-y-3">
            {services.map((service) => (
              <article key={service.id} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong>{service.name}</strong>
                    <p className="text-sm text-slate-500">{service.durationMin} min • R$ {service.price.toFixed(2)}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{service.active ? "Ativo" : "Inativo"}</span>
                </div>
              </article>
            ))}
            {!services.length && <p className="text-sm text-slate-500">Nenhum servico cadastrado.</p>}
          </div>
        </div>

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Profissionais cadastrados</h2>
          <div className="mt-4 space-y-3">
            {professionals.map((professional) => (
              <article key={professional.id} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong>{professional.name}</strong>
                    <p className="text-sm text-slate-500">{professional.specialty} • nota {professional.rating.toFixed(1)}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{professional.active ? "Ativo" : "Inativo"}</span>
                </div>
              </article>
            ))}
            {!professionals.length && <p className="text-sm text-slate-500">Nenhum profissional cadastrado.</p>}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Agendamentos</h2>
        <div className="mt-4 space-y-3">
          {appointments.map((appointment) => (
            <article key={appointment.id} className="rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong>{appointment.customerName}</strong>
                  <p className="text-sm text-slate-500">{appointment.service.name} • {appointment.professional?.name ?? "Sem profissional"}</p>
                  <p className="text-xs text-slate-400">{new Date(appointment.appointmentDate).toLocaleDateString("pt-BR")} {appointment.appointmentTime}</p>
                </div>
                <div className="text-right">
                  <strong>R$ {appointment.total.toFixed(2)}</strong>
                  <p className="text-xs uppercase text-amber-600">{appointment.status}</p>
                </div>
              </div>
            </article>
          ))}
          {!appointments.length && <p className="text-sm text-slate-500">Nenhum agendamento cadastrado.</p>}
        </div>
      </section>
    </main>
  );
}
