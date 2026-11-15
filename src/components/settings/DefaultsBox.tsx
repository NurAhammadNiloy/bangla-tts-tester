"use client";

import Info from "@/components/Info";
import { saveSettings, type CaptionStyle, type VideoDefaults } from "@/lib/settings";
import { useSettings } from "./useSettings";

type Opt<T> = { value: T; label: string };

function Chips<T extends string | boolean>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${on ? "chip-on" : "chip-off"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const CAPTIONS: Opt<CaptionStyle>[] = [
  { value: "box", label: "Box" },
  { value: "clean", label: "Clean" },
  { value: "headline", label: "Headline" },
  { value: "bubbles", label: "Bubbles" },
];

export default function DefaultsBox() {
  const { defaults } = useSettings();
  const set = (patch: Partial<VideoDefaults>) => saveSettings({ defaults: patch });

  return (
    <section aria-labelledby="defaults-h" className="card">
      <h2 id="defaults-h" className="flex items-center text-lg font-bold">
        🎚️ New video defaults
        <Info title="New video defaults">Every new video starts with these choices. You can still change them for each video.</Info>
      </h2>
      <div className="mt-4 space-y-4">
        <div>
          <span className="label">
            Narrator
            <Info title="Narrator">The main storytelling voice: a woman&apos;s or a man&apos;s Bangla voice. Characters can still get their own voices.</Info>
          </span>
          <Chips
            name="Narrator"
            value={defaults.narrator}
            options={[
              { value: "female", label: "👩 Female" },
              { value: "male", label: "👨 Male" },
            ]}
            onChange={(v) => set({ narrator: v })}
          />
        </div>
        <div>
          <span className="label">
            Subtitle style
            <Info title="Subtitle style">
              How the words appear on screen. Box: text on a dark strip. Clean: text with a soft shadow. Headline: big bold words. Bubbles: speech bubbles
              near the speaker. The spoken word always lights up in yellow.
            </Info>
          </span>
          <Chips name="Subtitle style" value={defaults.captionStyle} options={CAPTIONS} onChange={(v) => set({ captionStyle: v })} />
        </div>
        <div>
          <span className="label">
            Video shape
            <Info title="Video shape">9:16 fills the whole phone screen (Facebook Reels and Stories). 4:5 is a bit shorter and fits the normal news feed.</Info>
          </span>
          <Chips
            name="Video shape"
            value={defaults.format}
            options={[
              { value: "9:16", label: "9:16 Full screen" },
              { value: "4:5", label: "4:5 Feed post" },
            ]}
            onChange={(v) => set({ format: v })}
          />
        </div>
        <div>
          <span className="label">
            Background music
            <Info title="Background music">Soft music under the narration, quieter whenever someone speaks. Turn it off for voice only.</Info>
          </span>
          <Chips
            name="Background music"
            value={defaults.music}
            options={[
              { value: true, label: "🎵 On" },
              { value: false, label: "Off" },
            ]}
            onChange={(v) => set({ music: v })}
          />
        </div>
      </div>
    </section>
  );
}
