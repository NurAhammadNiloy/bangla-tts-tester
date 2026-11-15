"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/merge", label: "Video Maker", short: "Video", icon: "🎬" },
  { href: "/", label: "Voice Lab", short: "Voice", icon: "🔊" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-[52px] max-w-3xl items-center gap-2 px-4">
        <Link href="/merge" className="mr-auto flex items-center gap-2 whitespace-nowrap font-display text-lg font-extrabold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm text-accent-ink" aria-hidden>
            গ
          </span>
          Golpo Studio
        </Link>
        <div className="flex rounded-full border border-line bg-surface p-0.5">
          {LINKS.map((l) => {
            const on = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${on ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
              >
                <span aria-hidden>{l.icon}</span> <span className="sm:hidden">{l.short}</span>
                <span className="hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
