import type { Metadata, Viewport } from "next";
import { Bebas_Neue, DM_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Delivery Lanchonete",
  description: "Cardapio online com checkout no WhatsApp",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#e76f51",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body className="font-body antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
