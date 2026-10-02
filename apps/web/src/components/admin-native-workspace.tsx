"use client";

import dynamic from "next/dynamic";
import type { ComponentType, MouseEvent } from "react";

const loading = () => <p role="status" className="py-8 text-slate-500">Carregando módulo…</p>;
const modules: Record<string, ComponentType> = {
  "/admin/manage/balcao": dynamic(() => import("../app/admin/manage/balcao/page"), { loading }),
  "/admin/manage/products": dynamic(() => import("../app/admin/manage/products/page"), { loading }),
  "/admin/manage/stock": dynamic(() => import("../app/admin/manage/stock/page"), { loading }),
  "/admin/manage/categories": dynamic(() => import("../app/admin/manage/categories/page"), { loading }),
  "/admin/manage/complements": dynamic(() => import("../app/admin/manage/complements/page"), { loading }),
  "/admin/manage/tables": dynamic(() => import("../app/admin/manage/tables/page"), { loading }),
  "/admin/manage/pdv": dynamic(() => import("../app/admin/manage/pdv/page"), { loading }),
  "/admin/manage/kitchen": dynamic(() => import("../app/admin/manage/kitchen/page"), { loading }),
  "/admin/manage/customers": dynamic(() => import("../app/admin/manage/customers/page"), { loading }),
  "/admin/manage/deliveries": dynamic(() => import("../app/admin/manage/deliveries/page"), { loading }),
  "/admin/manage/coupons": dynamic(() => import("../app/admin/manage/coupons/page"), { loading }),
  "/admin/manage/reports": dynamic(() => import("../app/admin/manage/reports/page"), { loading }),
  "/admin/manage/finance": dynamic(() => import("../app/admin/manage/finance/page"), { loading }),
  "/admin/manage/users": dynamic(() => import("../app/admin/manage/users/page"), { loading }),
  "/admin/manage/settings": dynamic(() => import("../app/admin/manage/settings/page"), { loading }),
  "/admin/manage/raffles": dynamic(() => import("../app/admin/manage/raffles/page"), { loading }),
  "/admin/account": dynamic(() => import("../app/admin/account/page"), { loading })
};

export default function AdminNativeWorkspace({ path, onNavigate }: { path: string; onNavigate: (path: string | null) => void }) {
  const Page = modules[path];
  function navigate(event: MouseEvent<HTMLDivElement>) {
    // Preserve downloads, new tabs, external URLs and routes with special parameters.
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a");
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.search || url.hash) return;
    if (url.pathname === "/admin" || modules[url.pathname] || url.pathname === "/admin/whatsapp") {
      event.preventDefault(); event.stopPropagation();
      onNavigate(url.pathname === "/admin" ? null : url.pathname === "/admin/whatsapp" ? "whatsapp-native" : url.pathname);
    }
  }
  return <div className="admin-native-workspace" onClickCapture={navigate}>
    <style>{`
      .admin-native-workspace { min-width:0; margin-top:24px; padding:0 0 24px; color:#102a43; }
      .admin-native-workspace > main { width:100%; max-width:none; margin:0; padding:0 0 32px; }
      .admin-native-workspace > main > h1,
      .admin-native-workspace > main > :first-child h1 { color:#102a43; letter-spacing:-.02em; }
      .admin-native-workspace > main > section,
      .admin-native-workspace > main > div > section { border-color:#d7e5df; box-shadow:0 8px 24px rgba(16,42,67,.06); }
      .admin-native-workspace input,
      .admin-native-workspace textarea,
      .admin-native-workspace select { border-color:#d7e5df; border-radius:12px; min-height:44px; }
      .admin-native-workspace textarea { min-height:96px; }
      .admin-native-workspace button,
      .admin-native-workspace a.rounded-lg,
      .admin-native-workspace a.rounded-xl { border-radius:10px; }
      .admin-native-workspace button:not(:disabled):hover,
      .admin-native-workspace a.rounded-lg:hover,
      .admin-native-workspace a.rounded-xl:hover { filter:brightness(.97); }
      .admin-native-workspace .input { border-color:#d7e5df; background:#fff; }
      .admin-native-workspace > main > .mx-auto { max-width:100%; }
      .admin-native-workspace > main:has(> .fixed.bottom-0) { padding-bottom:100px; }
      .admin-native-workspace > main > :first-child { flex-wrap:wrap; gap:12px; margin-bottom:16px; }
      .admin-native-workspace .rounded-2xl { border-radius:16px; }
      @media(min-width:768px) { .admin-native-workspace > main > .fixed.inset-x-0.bottom-0 { left:248px; } }
      @media(max-width:767px) { .admin-native-workspace { margin-top:16px; } .admin-native-workspace > main { padding-bottom:20px; } }
    `}</style>
    {Page ? <Page key={path} /> : <p>Este módulo não está disponível. <a href={path}>Abrir página original</a></p>}
  </div>;
}
