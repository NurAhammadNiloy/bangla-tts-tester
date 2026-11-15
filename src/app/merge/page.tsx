import type { Metadata } from "next";
import MergeTester from "@/components/MergeTester";

export const metadata: Metadata = { title: "Video Maker · Golpo Studio" };

export default function MergePage() {
  return (
    <main className="flex-1">
      <MergeTester />
    </main>
  );
}
