"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi, type AdminUser } from "../lib/admin-api";
import { AdminPanel } from "./admin-panel";
import { RaffleAdminPanel } from "./raffle-admin-panel";

type AdminUserWithCompany = AdminUser & {
  company?: {
    id: string;
    tradeName: string;
    subdomain: string;
    active: boolean;
    businessType?: string;
  } | null;
};

export function AdminHome() {
  const [user, setUser] = useState<AdminUserWithCompany | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi<AdminUserWithCompany>("/admin/me")
      .then(setUser)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar usuário"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-2xl bg-white/85 p-5 shadow-sm">Carregando painel...</div>
      </main>
    );
  }

  if (user?.company?.businessType === "RAFFLE") {
    return <RaffleAdminPanel />;
  }

  return <AdminPanel />;
}
