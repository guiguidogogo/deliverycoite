"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";

type Session = {
  name: string;
  role: string;
  company: {
    tradeName: string;
    subdomain: string;
  };
};
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "hubregional.com.br";

export function AdminSessionBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const realCompanyUrl = session
    ? `https://${session.company.subdomain}.${ROOT_DOMAIN}`
    : "#";
  const companyUrl =
    typeof window !== "undefined" && window.location.hostname.endsWith(ROOT_DOMAIN)
      ? realCompanyUrl
      : session
        ? `/?subdomain=${encodeURIComponent(session.company.subdomain)}`
        : "#";

  useEffect(() => {
    if (pathname === "/admin/login") return;
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    void fetch(`${API_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setSession(data));
  }, [pathname]);

  if (pathname === "/admin/login" || !session) return null;

  function logout() {
    localStorage.removeItem("delivery:token");
    localStorage.removeItem("delivery:admin-user");
    localStorage.removeItem("delivery:subdomain");
    router.replace("/admin/login");
  }

  return (
    <aside className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-white/95 px-4 py-2 text-sm shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
      <div>
        <strong>{session.company.tradeName}</strong>
        <span className="ml-2 opacity-60">
          {session.company.subdomain}.{ROOT_DOMAIN}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <a
          className="text-xs underline"
          href={companyUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ver loja em homologacao
        </a>
        <span className="text-xs opacity-60">{session.name}</span>
        <button className="rounded-lg bg-red-600 px-3 py-1.5 text-white" onClick={logout}>
          Sair
        </button>
      </div>
    </aside>
  );
}
