import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vórtex Vault - Tus claves, sin límites",
  description:
    "Vórtex Vault, de Vortex Company: gestor de contraseñas y datos seguros cifrado con AES-256 dentro de tu propio navegador (Web Crypto + IndexedDB). Cero nube, cero suscripciones, generador de contraseñas y medidor de seguridad. Gratis y sin anuncios.",
  keywords: [
    "Vórtex Vault",
    "gestor de contraseñas",
    "password manager",
    "cifrado local",
    "AES-256",
    "Web Crypto",
    "generador de contraseñas",
    "sin nube",
    "sin anuncios",
  ],
  authors: [{ name: "Vortex Company" }],
  icons: {
    icon:
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#161616"/><circle cx="24" cy="24" r="17" fill="none" stroke="#d946ef" stroke-width="3.5"/><path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke="#e879f9" stroke-width="3.5" stroke-linecap="round"/><path d="M24 17a7 7 0 1 0 7 7" fill="none" stroke="#e879f9" stroke-width="3.5" stroke-linecap="round"/><circle cx="24" cy="24" r="3" fill="#e879f9"/></svg>`
      ),
  },
  openGraph: {
    title: "Vórtex Vault - Tus claves, sin límites",
    description:
      "Gestor de contraseñas cifrado con AES-256 que nunca sale de tu navegador. Cero nube, generador de contraseñas y medidor de seguridad. Gratis, sin anuncios. De Vortex Company.",
    siteName: "Vórtex Vault",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-[#0f0f10] text-[#ececf1]">{children}</body>
    </html>
  );
}
