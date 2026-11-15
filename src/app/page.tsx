import Link from "next/link";
import Info from "@/components/Info";
import ContinueList from "@/components/home/ContinueList";
import SampleCard from "@/components/home/SampleCard";

const STEPS = [
  { icon: "✍️", bn: "গল্প দিন", en: "Paste your story", note: "Any Bangla story, short or long. Long stories become a series." },
  { icon: "🎨", bn: "স্টাইল বাছুন", en: "Pick a style", note: "Choose the look, the narrator voice and the subtitles." },
  { icon: "🎬", bn: "ভিডিও পান", en: "Get your video", note: "Download a tall video, ready to post on Facebook." },
];

export default function Home() {
  return (
    <main className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-12 pt-8 sm:gap-10 sm:pt-14">
        <header className="text-center">
          <p className="bangla font-display text-[2.6rem] font-extrabold leading-[1.05] sm:text-6xl">গল্প থেকে ভিডিও</p>
          <h1 className="mx-auto mt-3 max-w-md font-sans text-lg font-medium leading-snug text-muted sm:text-xl">
            Paste a Bangla story. Get a narrated story video for your Facebook page.
          </h1>
          <div className="mt-6 flex items-center justify-center">
            <Link href="/create" className="btn-primary w-full max-w-sm py-4 text-lg sm:w-auto sm:px-8">
              <span className="bangla">নতুন ভিডিও বানান</span>
              <span aria-hidden className="opacity-50">·</span>
              <span>Make a video</span>
            </Link>
            <Info title="Make a video">
              Opens a short guide: paste your story, choose a style, and the app makes the voice, pictures and subtitles for you.
              You need an OpenRouter key, which the guide helps you add.
            </Info>
          </div>
        </header>

        <section aria-labelledby="how-h">
          <h2 id="how-h" className="sr-only">
            How it works
          </h2>
          <ol className="grid grid-cols-3 gap-2 sm:gap-3">
            {STEPS.map((s, i) => (
              <li key={s.en} className="relative rounded-2xl border border-line bg-surface px-2 py-3 text-center sm:px-4 sm:py-4">
                <span aria-hidden className="text-2xl sm:text-3xl">
                  {s.icon}
                </span>
                <span className="bangla mt-1 block text-[15px] font-bold leading-tight sm:text-lg">{s.bn}</span>
                <span className="block text-xs text-muted sm:text-sm">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.en}
                </span>
                <span className="mt-1 hidden text-xs text-muted sm:block">{s.note}</span>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="absolute -right-[9px] top-1/2 z-10 hidden -translate-y-1/2 text-accent-strong sm:-right-[11px] min-[360px]:block">
                    ›
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <ContinueList />

        <SampleCard />

        <section aria-label="More tools" className="grid gap-2 sm:grid-cols-2">
          <Link href="/voice" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:border-accent">
            <span aria-hidden className="text-xl">🔊</span>
            <span className="flex-1">
              <span className="block font-semibold">Voice Lab</span>
              <span className="block text-xs text-muted">Try Bangla voices on a few lines</span>
            </span>
          </Link>
          <Link href="/studio" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:border-accent">
            <span aria-hidden className="text-xl">🎛️</span>
            <span className="flex-1">
              <span className="block font-semibold">Studio (advanced)</span>
              <span className="block text-xs text-muted">Every setting, scene by scene</span>
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
