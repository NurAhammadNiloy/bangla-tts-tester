import Link from "next/link";

export default function Nav() {
  return (
    <nav className="sticky top-0 z-20 border-b border-stone-200 bg-[var(--background)]/90 backdrop-blur dark:border-stone-800">
      <div className="mx-auto flex max-w-3xl gap-1 px-4 py-2 text-sm font-medium">
        <Link href="/" className="rounded-lg px-3 py-1.5 hover:bg-stone-200 dark:hover:bg-stone-800">
          🔊 Voice tester
        </Link>
        <Link href="/merge" className="rounded-lg px-3 py-1.5 hover:bg-stone-200 dark:hover:bg-stone-800">
          🎞 Video merge test
        </Link>
      </div>
    </nav>
  );
}
