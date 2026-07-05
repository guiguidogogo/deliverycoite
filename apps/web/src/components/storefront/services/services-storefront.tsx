"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { resolveAssetUrl } from "../../../lib/api";
import type { PublicCompany } from "../../../lib/types";

type ServiceItem = {
  id: string;
  name: string;
  duration: number;
  price: number;
  description: string;
  popular?: boolean;
};

type Professional = {
  id: string;
  name: string;
  specialty: string;
  avatarUrl?: string | null;
  rating: number;
  bio: string;
};

const servicesByType: Record<string, { title: string; subtitle: string; services: ServiceItem[]; professionals: Professional[] }> = {
  BARBERSHOP: {
    title: "Barbearia",
    subtitle: "Escolha o servico, o barbeiro e o melhor horario.",
    services: [
      { id: "corte", name: "Corte masculino", duration: 40, price: 35, description: "Corte, acabamento e finalizacao.", popular: true },
      { id: "barba", name: "Barba completa", duration: 30, price: 25, description: "Modelagem e toalha quente." },
      { id: "combo", name: "Corte + barba", duration: 60, price: 55, description: "Combo completo com desconto.", popular: true }
    ],
    professionals: [
      { id: "1", name: "Rafael", specialty: "Fade e degradê", rating: 4.9, bio: "Especialista em cortes modernos." },
      { id: "2", name: "Joao", specialty: "Barba e desenho", rating: 4.8, bio: "Acabamento fino e atendimento rapido." }
    ]
  },
  BEAUTY_SALON: {
    title: "Salao de beleza",
    subtitle: "Agende servicos com profissional, horario e duracao.",
    services: [
      { id: "escova", name: "Escova", duration: 45, price: 45, description: "Liso alinhado e acabamento elegante.", popular: true },
      { id: "unhas", name: "Unhas", duration: 60, price: 40, description: "Manicure e pedicure." },
      { id: "sobrancelha", name: "Design de sobrancelhas", duration: 25, price: 30, description: "Modelagem e acabamento." }
    ],
    professionals: [
      { id: "1", name: "Marina", specialty: "Penteados e escovas", rating: 5.0, bio: "Atendimento delicado e acabamento premium." },
      { id: "2", name: "Bianca", specialty: "Unhas e sobrancelhas", rating: 4.9, bio: "Rapidez com cuidado nos detalhes." }
    ]
  }
};

const schedule = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function ServicesStorefront({ company }: { company: PublicCompany }) {
  const copy = servicesByType[company.businessType] ?? servicesByType.BARBERSHOP;
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(copy.services[0] ?? null);
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(copy.professionals[0] ?? null);
  const [selectedTime, setSelectedTime] = useState(schedule[2]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });

  const total = useMemo(() => selectedService?.price ?? 0, [selectedService]);

  function reserve() {
    if (!customer.name || !customer.phone) {
      toast.error("Informe nome e telefone para continuar");
      return;
    }
    toast.success("Pedido de agendamento criado. A integracao de pagamento online entra na proxima fase.");
  }

  return (
    <main className="min-h-screen bg-[#0f172a] text-white">
      <section className="relative overflow-hidden px-4 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#f59e0b_0,transparent_30%),radial-gradient(circle_at_bottom_right,#14b8a6_0,transparent_28%)] opacity-30" />
        <div className="relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[.95fr_1.05fr]">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-white text-slate-950">
                {company.logoUrl ? (
                  <Image src={resolveAssetUrl(company.logoUrl)} alt={company.tradeName} width={64} height={64} className="h-full w-full object-contain p-1" unoptimized />
                ) : (
                  company.tradeName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-200">HubRegional {copy.title}</p>
                <h1 className="text-4xl font-black">{company.tradeName}</h1>
                <p className="text-white/65">{copy.subtitle}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {copy.services.map((service) => (
                <button
                  key={service.id}
                  className={`rounded-2xl border p-4 text-left transition ${selectedService?.id === service.id ? "border-amber-300 bg-amber-300/20" : "border-white/10 bg-white/5"}`}
                  onClick={() => setSelectedService(service)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <strong>{service.name}</strong>
                    {service.popular && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-slate-950">Popular</span>}
                  </div>
                  <p className="mt-2 text-sm text-white/70">{service.description}</p>
                  <p className="mt-3 text-sm font-bold text-amber-200">{money.format(service.price)} • {service.duration} min</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white p-5 text-slate-950">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-600">Escolha seu profissional</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {copy.professionals.map((pro) => (
                  <button
                    key={pro.id}
                    className={`rounded-2xl border p-4 text-left transition ${selectedProfessional?.id === pro.id ? "border-amber-500 bg-amber-50" : "border-slate-200"}`}
                    onClick={() => setSelectedProfessional(pro)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-slate-100">
                        {pro.avatarUrl ? (
                          <Image src={resolveAssetUrl(pro.avatarUrl)} alt={pro.name} width={56} height={56} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          pro.name.slice(0, 1)
                        )}
                      </div>
                      <div>
                        <strong>{pro.name}</strong>
                        <p className="text-sm text-slate-500">{pro.specialty}</p>
                        <p className="text-xs font-bold text-amber-600">Nota {pro.rating.toFixed(1)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{pro.bio}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white p-5 text-slate-950">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-600">Horario</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {schedule.map((slot) => (
                  <button
                    key={slot}
                    className={`rounded-full px-4 py-2 text-sm font-bold ${selectedTime === slot ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}
                    onClick={() => setSelectedTime(slot)}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white p-5 text-slate-950">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-600">Checkout</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <input className="rounded-xl border px-3 py-3" placeholder="Nome completo" value={customer.name} onChange={(event) => setCustomer((value) => ({ ...value, name: event.target.value }))} />
                <input className="rounded-xl border px-3 py-3" placeholder="WhatsApp" value={customer.phone} onChange={(event) => setCustomer((value) => ({ ...value, phone: event.target.value }))} />
                <input className="rounded-xl border px-3 py-3" placeholder="Email" type="email" value={customer.email} onChange={(event) => setCustomer((value) => ({ ...value, email: event.target.value }))} />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr]">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Servico selecionado</p>
                  <strong className="text-xl">{selectedService?.name ?? "Nenhum"}</strong>
                  <p className="text-sm text-slate-600">{selectedProfessional?.name ?? "Profissional"}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Total</p>
                  <strong className="text-3xl text-emerald-600">{money.format(total)}</strong>
                  <p className="text-sm text-slate-600">Horário {selectedTime}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-2xl bg-slate-950 px-5 py-3 font-black text-white" onClick={reserve}>
                  Reservar e pagar depois
                </button>
                <button className="rounded-2xl border border-emerald-600 px-5 py-3 font-black text-emerald-700" onClick={() => toast.info("Pagamento online entra na proxima fase.")}>
                  Pagar online
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
