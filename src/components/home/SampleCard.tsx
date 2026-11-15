import Info from "@/components/Info";

/**
 * Placeholder for the sample episode. Another builder ships the real video;
 * swap the frame contents for a <video> when it lands.
 */
export default function SampleCard() {
  return (
    <section aria-labelledby="sample-h" className="card flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div
        aria-hidden
        className="relative aspect-[9/16] w-36 shrink-0 overflow-hidden rounded-[18px] border border-line bg-[#12162e] shadow-[0_18px_40px_-20px_rgba(18,22,46,0.8)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(120px_160px_at_70%_20%,rgba(244,177,62,0.35),transparent_70%)]" />
        <div className="absolute left-1/2 top-[22%] h-12 w-12 -translate-x-1/2 rounded-full bg-[#ece9f7]/90 shadow-[0_0_30px_rgba(236,233,247,0.5)]" />
        <div className="absolute inset-x-0 bottom-[30%] h-16 bg-[#1b2142]" style={{ clipPath: "polygon(0 60%, 25% 30%, 45% 55%, 70% 20%, 100% 50%, 100% 100%, 0 100%)" }} />
        <p className="bangla absolute inset-x-2 bottom-[12%] rounded-md bg-black/55 px-1.5 py-1 text-center text-[11px] font-semibold leading-snug text-white">
          সেই রাতে <span className="rounded bg-[#f4b13e] px-0.5 text-[#1a1d3b]">দরজায়</span> কেউ ছিল
        </p>
      </div>
      <div className="text-center sm:text-left">
        <h2 id="sample-h" className="flex items-center justify-center text-xl font-bold sm:justify-start">
          Sample episode coming soon
          <Info title="Sample episode">
            A short finished video made with Golpo Studio will play here, so you can see the result before you start.
          </Info>
        </h2>
        <p className="mt-1 text-sm text-muted">
          Every video looks like this: a tall picture for phones, Bangla narration, and subtitles where the spoken word lights up.
        </p>
      </div>
    </section>
  );
}
