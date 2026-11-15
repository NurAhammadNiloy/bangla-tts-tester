import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Golpo Studio · Bangla story videos",
  description:
    "Turn a Bangla story into a vertical Facebook story video: Bangla narration, highlighted subtitles and cartoon pictures, made in your browser with your own OpenRouter key.",
  robots: { index: false, follow: false },
  applicationName: "Golpo Studio",
  appleWebApp: { capable: true, title: "Golpo Studio", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2fa" },
    { media: "(prefers-color-scheme: dark)", color: "#12162e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Bangla fonts for every page, loaded at runtime */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Nav />
        {children}
        <div aria-hidden className="h-16 shrink-0 sm:hidden" />
      </body>
    </html>
  );
}
