import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/service-worker-register";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"] });

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "MediTrack | Diabetes health record",
  description: "Track glucose, nutrition, and hydration in one clinically grounded health record.",
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "MediTrack", statusBarStyle: "default" },
  icons: { icon: `${basePath}/icon-192.png`, apple: `${basePath}/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#173f37",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${plex.variable} ${newsreader.variable}`}><body>{children}<ServiceWorkerRegister /></body></html>;
}