import withPWA from "next-pwa";

const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  experimental: {
    typedRoutes: true
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3333/api/:path*'
      },
      {
        source: '/ws-admin',
        destination: 'http://localhost:3333/ws-admin'
      }
    ];
  }
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development"
})(nextConfig);
