import withPWA from "next-pwa";

const apiServerUrl = process.env.API_SERVER_HOST
  ? `http://${process.env.API_SERVER_HOST}`
  : (process.env.API_SERVER_URL ?? "http://localhost:3333").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  experimental: {
    typedRoutes: true
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiServerUrl}/api/:path*`
      },
      {
        source: "/ws-admin",
        destination: `${apiServerUrl}/ws-admin`
      }
    ];
  }
};

export default withPWA({
  dest: "public",
  disable: true
})(nextConfig);
