import type { Metadata } from "next";
import Link from "next/link";
import Info from "@/components/Info";
import BrandBox from "@/components/settings/BrandBox";
import DefaultsBox from "@/components/settings/DefaultsBox";
import KeyBox from "@/components/settings/KeyBox";

export const metadata: Metadata = { title: "Settings · Golpo Studio" };

export default function SettingsPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-12 pt-6 sm:pt-10">
        <header>
          <h1 className="text-3xl font-extrabold">Settings</h1>
          <p className="text-sm text-muted">Saved in this browser only.</p>
        </header>
        <KeyBox />
        <BrandBox />
        <DefaultsBox />
        <section aria-labelledby="studio-h" className="card flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="studio-h" className="flex items-center text-lg font-bold">
              🎛️ Studio <span className="ml-1.5 text-sm font-medium text-muted">(advanced)</span>
              <Info title="Studio">The full workbench with every setting for each scene. Most people never need it; the Make guide does the same steps for you.</Info>
            </h2>
            <p className="text-sm text-muted">Fine-tune scenes, voices and pictures by hand.</p>
          </div>
          <Link href="/studio" className="btn-secondary">
            Open Studio
          </Link>
        </section>
      </div>
    </main>
  );
}
