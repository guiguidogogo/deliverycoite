"use client";

import { useEffect, useState } from "react";
import { MarketplaceHome } from "./marketplace-home";
import { Storefront } from "./storefront";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "hubregional.com.br";

function isStoreRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("subdomain")) return true;

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".onrender.com")) return false;
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === `admin.${ROOT_DOMAIN}`) return false;
  return host.endsWith(`.${ROOT_DOMAIN}`);
}

export function TenantHome() {
  const [mode, setMode] = useState<"loading" | "marketplace" | "store">("loading");

  useEffect(() => {
    setMode(isStoreRequest() ? "store" : "marketplace");
  }, []);

  if (mode === "loading") {
    return <main className="min-h-screen bg-[#fffaf5]" aria-busy="true" />;
  }

  return mode === "store" ? <Storefront /> : <MarketplaceHome />;
}
