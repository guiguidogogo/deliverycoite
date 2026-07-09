"use client";

import { useEffect, useState } from "react";
import { getBrowserRootDomain } from "../lib/api";
import { MarketplaceHome } from "./marketplace-home";
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

  useEffect(() => {
    setMode(isStoreRequest() ? "store" : "marketplace");
  }, []);

  if (mode === "loading") {
    return <main className="min-h-screen bg-[#fffaf5]" aria-busy="true" />;
  }

  return mode === "store" ? <Storefront /> : <MarketplaceHome />;
}
