import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bebas_Neue, DM_Sans } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { Toaster } from "sonner";

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "HubRegional | Tudo perto de você",
  description: "Marketplace regional de restaurantes, mercados, farmácias e serviços locais.",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#e76f51",
  width: "device-width",
  initialScale: 1
};

const disableLegacyServiceWorker = `
(() => {
  const clearCaches = () => {
    if (!("caches" in window)) return;
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => undefined);
  };

  clearCaches();

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(clearCaches)
    .catch(() => undefined);
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body className="font-body antialiased">
        <Script
          id="disable-legacy-service-worker"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: disableLegacyServiceWorker }}
        />
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
