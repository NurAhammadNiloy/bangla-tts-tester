import type { Metadata } from "next";
import MergeTester from "@/components/MergeTester";

export const metadata: Metadata = { title: "Voice + Video Merge · Bangla TTS" };

export default function MergePage() {
  return (
    <main className="flex-1">
      <MergeTester />
    </main>
  );
}
