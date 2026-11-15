import type { Metadata } from "next";
import TtsTester from "@/components/TtsTester";

export const metadata: Metadata = { title: "Voice Lab · Golpo Studio" };

export default function VoicePage() {
  return (
    <main className="flex-1">
      <TtsTester />
    </main>
  );
}
