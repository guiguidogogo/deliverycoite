const apiServerUrl = process.env.API_SERVER_HOST
  ? `http://${process.env.API_SERVER_HOST}`
  : (process.env.API_SERVER_URL
      ?? (process.env.API_URL && process.env.API_URL !== "/api" ? process.env.API_URL : undefined)
      ?? (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "/api" ? process.env.NEXT_PUBLIC_API_URL : undefined)
      ?? "http://localhost:3333"
    ).replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  typedRoutes: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiServerUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
