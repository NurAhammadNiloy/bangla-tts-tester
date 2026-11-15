/** The starter asset library and helpers for prompts. */
import type { AssetLibrary } from "../types";
import { STARTER_CHARACTERS, recolor, buildCharacter, CHARACTER_SPECS, shade } from "./characters";
import { STARTER_PLACES } from "./places";
import { STARTER_PROPS } from "./props";

export { recolor, buildCharacter, CHARACTER_SPECS, shade, STARTER_CHARACTERS, STARTER_PLACES, STARTER_PROPS };

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));

export const STARTER_LIBRARY: AssetLibrary = {
  characters: byId(STARTER_CHARACTERS),
  places: byId(STARTER_PLACES),
  props: byId(STARTER_PROPS),
};

/** Compact list of ids, labels and tags for LLM prompts. */
export function summarizeLibrary(lib: AssetLibrary): string {
  const sec = (title: string, xs: { id: string; label?: string; tags: string[] }[]) =>
    `${title}:\n` + xs.map((x) => `- ${x.id}${x.label ? ` — ${x.label}` : ""} [${x.tags.slice(0, 8).join(", ")}]`).join("\n");
  return [
    sec("CHARACTERS", Object.values(lib.characters)),
    sec("PLACES", Object.values(lib.places)),
    sec("PROPS", Object.values(lib.props)),
  ].join("\n\n");
}

/** Merge extra assets (e.g. from the asset maker) over a base library. */
export function mergeLibrary(base: AssetLibrary, extra: Partial<AssetLibrary>): AssetLibrary {
  return {
    characters: { ...base.characters, ...(extra.characters ?? {}) },
    places: { ...base.places, ...(extra.places ?? {}) },
    props: { ...base.props, ...(extra.props ?? {}) },
  };
}
