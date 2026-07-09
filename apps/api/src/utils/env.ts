function normalizeHost(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "");
}

function deriveRootDomain(value?: string | null) {
  const host = normalizeHost(value ?? "");
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return parts.slice(1).join(".");
}

export const env = {
  get port() {
    return Number(process.env.API_PORT ?? 3333);
  },
  get jwtSecret() {
    return process.env.JWT_SECRET ?? "change_me";
  },
  get whatsappNumber() {
    return process.env.WHATSAPP_NUMBER ?? "5575999999999";
  },
  get corsOrigin() {
    return process.env.CORS_ORIGIN ?? "http://localhost:3000";
  },
  get corsOrigins() {
    return this.corsOrigin
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean);
  },
  get rootDomain() {
    const configured = (process.env.ROOT_DOMAIN ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (configured) return configured;

    const coolifyFqdn = process.env.COOLIFY_FQDN ?? process.env.COOLIFY_URL;
    const derived = deriveRootDomain(coolifyFqdn);
    if (derived) return derived;

    return "hubregional.com.br";
  }
};
