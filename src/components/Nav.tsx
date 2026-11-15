"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** One list, one set of names, used by the top bar (wide) and the bottom tab bar (phones). */
export const NAV_LINKS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/create", label: "Make", icon: "✨" },
  { href: "/projects", label: "Projects", icon: "📚" },
  { href: "/voice", label: "Voice", icon: "🔊" },
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export default function Nav() {
  const path = usePathname() ?? "/";
  const settingsOn = isActive(path, "/settings");
  return (
    <>
      <nav aria-label="Main" className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-[52px] max-w-3xl items-center gap-2 px-4">
          <Link href="/" className="mr-auto flex items-center gap-2 whitespace-nowrap font-display text-lg font-extrabold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm text-accent-ink" aria-hidden>
              গ
            </span>
            Golpo Studio
          </Link>
          <div className="hidden rounded-full border border-line bg-surface p-0.5 sm:flex">
            {NAV_LINKS.map((l) => {
              const on = isActive(path, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${on ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
                >
                  <span aria-hidden>{l.icon}</span> {l.label}
                </Link>
              );
            })}
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            aria-current={settingsOn ? "page" : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-full border text-base transition ${
              settingsOn ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:border-accent hover:text-ink"
            }`}
          >
            <span aria-hidden>⚙️</span>
          </Link>
        </div>
      </nav>

      {/* Phones: thumb-friendly tab bar. Layout adds a matching spacer at the bottom. */}
      <nav
        aria-label="Main (tabs)"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-4">
          {NAV_LINKS.map((l) => {
            const on = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${on ? "text-ink" : "text-muted"}`}
              >
                <span
                  aria-hidden
                  className={`flex h-7 w-12 items-center justify-center rounded-full text-base transition ${on ? "bg-accent" : ""}`}
                >
                  {l.icon}
                </span>
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
