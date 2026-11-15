import type { Metadata } from "next";
import Link from "next/link";
import Info from "@/components/Info";
import ProjectsList from "@/components/projects/ProjectsList";

export const metadata: Metadata = { title: "My projects · Golpo Studio" };

export default function ProjectsPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-6 sm:pt-10">
        <header className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center text-3xl font-extrabold">
              My projects
              <Info title="My projects">
                Stories you started are saved in this browser only. If you clear your browser data or switch phones, they won&apos;t come along.
              </Info>
            </h1>
            <p className="text-sm text-muted">
              <span className="bangla">আমার গল্পগুলো</span>, saved on this device
            </p>
          </div>
          <Link href="/create" className="btn-secondary">
            ✨ New video
          </Link>
        </header>
        <ProjectsList />
      </div>
    </main>
  );
}
