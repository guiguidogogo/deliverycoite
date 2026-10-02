"use client";

import WhatsAppPage from "../../../components/whatsapp-page";

export default function AdminWhatsAppPage() {
  const token = typeof window !== "undefined" ? localStorage.getItem("delivery:token") ?? "" : "";
  return <main className="min-h-screen bg-emerald-50 p-4 md:p-8"><WhatsAppPage token={token} /></main>;
}
