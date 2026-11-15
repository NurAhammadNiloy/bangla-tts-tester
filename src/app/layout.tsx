import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bangla TTS Tester",
  description: "Test Bengali text-to-speech through OpenRouter with your own API key.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
