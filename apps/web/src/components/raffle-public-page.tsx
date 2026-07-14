"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { PublicCompany } from "../lib/types";
import { RaffleStorefront } from "./raffle-storefront";

export function RafflePublicPage({ slug }: { slug: string }) {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<PublicCompany>("/company")
      .then(setCompany)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Empresa nao encontrada"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <main className="min-h-screen bg-[#070912]" aria-busy="true" />;
  }

  if (!company || company.businessType !== "RAFFLE") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf5] px-4 text-center text-ink">
        <section className="max-w-md rounded-3xl bg-white p-8 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">HubRegional</p>
          <h1 className="mt-2 font-display text-4xl">Rifa nao encontrada</h1>
          <p className="mt-3 text-sm opacity-70">Este link nao pertence a uma vitrine de rifas ativa.</p>
        </section>
      </main>
    );
  }

  return <RaffleStorefront company={company} initialSlug={slug} />;
}
