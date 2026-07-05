"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { PublicCompany } from "../../lib/types";
import { Storefront } from "../storefront";
import { EventsStorefront } from "./events/events-storefront";
import { ServicesStorefront } from "./services/services-storefront";

export function SegmentStorefront() {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch("/company", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message ?? "Empresa nao encontrada");
        setCompany(payload);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Empresa nao encontrada"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <main className="min-h-screen bg-[#fffaf5]" aria-busy="true" />;
  }

  if (error || !company) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf5] p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-orange-600">HubRegional</p>
          <h1 className="mt-3 text-3xl font-black">Empresa nao encontrada</h1>
          <p className="mt-2 text-slate-600">{error || "Verifique o endereco acessado."}</p>
        </div>
      </main>
    );
  }

  if (company.businessType === "EVENTS") {
    return <EventsStorefront company={company} />;
  }

  if (company.businessType === "BARBERSHOP" || company.businessType === "BEAUTY_SALON") {
    return <ServicesStorefront company={company} />;
  }

  return <Storefront />;
}
