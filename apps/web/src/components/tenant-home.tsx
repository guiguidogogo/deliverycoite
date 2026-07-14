"use client";

import { useEffect, useState } from "react";
import { api, getBrowserRootDomain } from "../lib/api";
import type { PublicCompany } from "../lib/types";
import { MarketplaceHome } from "./marketplace-home";
import { RaffleStorefront } from "./raffle-storefront";
import { Storefront } from "./storefront";

function isStoreRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("subdomain")) return true;

  const host = window.location.hostname.toLowerCase();
  const rootDomain = getBrowserRootDomain();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".onrender.com")) return false;
  if (host === rootDomain || host === `www.${rootDomain}` || host === `admin.${rootDomain}`) return false;
  return host.endsWith(`.${rootDomain}`);
}

export function TenantHome() {
  const [mode, setMode] = useState<"loading" | "marketplace" | "store">("loading");
  const [company, setCompany] = useState<PublicCompany | null>(null);

  useEffect(() => {
    const storeRequest = isStoreRequest();
    if (!storeRequest) {
      setMode("marketplace");
      return;
    }
    api<PublicCompany>("/company")
      .then((payload) => {
        setCompany(payload);
        setMode("store");
      })
      .catch(() => setMode("store"));
  }, []);

  if (mode === "loading") {
    return <main className="min-h-screen bg-[#fffaf5]" aria-busy="true" />;
  }

  if (mode === "store" && company?.businessType === "RAFFLE") {
    return <RaffleStorefront company={company} />;
  }

  return mode === "store" ? <Storefront /> : <MarketplaceHome />;
}
