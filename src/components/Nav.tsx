"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/merge", label: "🎬 Video Maker", hint: "Make a full video" },
  { href: "/", label: "🔊 Voice Lab", hint: "Try voices & moods" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-20 border-b border-stone-200 bg-[var(--background)]/90 backdrop-blur dark:border-stone-800">
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-2">
        <span className="mr-2 hidden text-sm font-bold sm:inline">Golpo Studio</span>
        {LINKS.map((l) => {
          const on = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={on ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                on ? "bg-teal-700 text-white" : "hover:bg-stone-200 dark:hover:bg-stone-800"
              }`}
            >
              {l.label}
              <span className={`ml-1.5 hidden text-xs sm:inline ${on ? "text-teal-100" : "text-stone-500"}`}>{l.hint}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
