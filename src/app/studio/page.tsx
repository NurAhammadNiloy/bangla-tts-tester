import type { Metadata } from "next";
import MergeTester from "@/components/MergeTester";

export const metadata: Metadata = { title: "Studio · Golpo Studio" };

export default function StudioPage() {
  return (
    <main className="flex-1">
      <MergeTester />
    </main>
  );
}
