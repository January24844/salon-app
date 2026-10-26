import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const sans = Inter({ variable: "--font-sans-app", subsets: ["latin", "latin-ext"] });
const serif = Playfair_Display({ variable: "--font-serif-app", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Mój Salon – rezerwacje",
  description: "Kalendarz wizyt i rezerwacje online",
  appleWebApp: { capable: true, title: "Mój Salon", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#B5838D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
