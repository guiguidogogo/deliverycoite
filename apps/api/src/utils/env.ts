export const env = {
  get port() {
    return Number(process.env.API_PORT ?? process.env.PORT ?? 3333);
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
  get rootDomain() {
    return (process.env.ROOT_DOMAIN ?? "hubregional.com.br")
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "");
  }
};
