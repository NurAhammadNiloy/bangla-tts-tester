import type { Metadata } from "next";
import { Suspense } from "react";
import PuppetPreview from "@/components/dev/PuppetPreview";

export const metadata: Metadata = {
  title: "Puppet engine preview · Golpo Studio",
  robots: { index: false, follow: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Preview({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]?.[0] : q[k]) as string | undefined;
  const shot = Number(one("shot") ?? 0);
  const t = Number(one("t") ?? 0);
  return (
    <PuppetPreview
      initialShot={Number.isFinite(shot) ? shot : 0}
      initialTime={Number.isFinite(t) ? t : 0}
      startPaused={one("paused") === "1"}
      only={one("only") === "player" ? "player" : one("only") === "assets" ? "assets" : undefined}
    />
  );
}

export default function PuppetsPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="flex-1">
      <Suspense fallback={<p className="p-6 text-sm">Loading preview…</p>}>
        <Preview searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
