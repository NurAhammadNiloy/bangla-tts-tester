import { describe, expect, it } from "vitest";
import { groupVoices, voiceInfo, voiceLabel } from "@/lib/voices";
import { presetVoice, STYLE_PRESETS } from "@/lib/voiceDirector";

const GEMINI_30 = ["Zephyr","Puck","Charon","Kore","Fenrir","Leda","Orus","Aoede","Callirrhoe","Autonoe","Enceladus","Iapetus","Umbriel","Algieba","Despina","Erinome","Algenib","Rasalgethi","Laomedeia","Achernar","Alnilam","Schedar","Gacrux","Pulcherrima","Achird","Zubenelgenubi","Vindemiatrix","Sadachbia","Sadaltager","Sulafat"];
const ELEVEN = ["george","sarah","adam","alice","bella","bill","brian","callum","charlie","chris","daniel","eric","harry","jessica","laura","liam","lily","matilda","river","roger","will"];

describe("voice gender labels", () => {
  it("labels every live Gemini voice: 14 female, 16 male", () => {
    const g = groupVoices("google/gemini-3.8-flash-tts", GEMINI_30);
    expect(g.female).toHaveLength(14);
    expect(g.male).toHaveLength(16);
    expect(g.other).toHaveLength(0);
    expect(voiceInfo("google/gemini-3.8-flash-tts", "Kore")).toEqual({ gender: "female", style: "Firm" });
    expect(voiceLabel("google/gemini-3.8-flash-tts", "Puck")).toBe("♂ Puck · Upbeat");
  });

  it("labels ElevenLabs premade voices; River stays neutral", () => {
    const g = groupVoices("elevenlabs/eleven-v3", ELEVEN);
    expect(g.other).toEqual(["river"]);
    expect(g.female).toEqual(["sarah", "alice", "bella", "jessica", "laura", "lily", "matilda"]);
    expect(voiceLabel("elevenlabs/eleven-v3", "george")).toBe("♂ george");
  });

  it("unknown providers are 'other'", () => {
    expect(voiceInfo("deepgram/aura-2", "aura-2-thalia-en").gender).toBeNull();
  });

  it("every preset voice exists and matches its gender", () => {
    for (const p of STYLE_PRESETS) {
      for (const gender of ["female", "male"] as const) {
        const gv = presetVoice(p, "gemini", gender)!;
        const ev = presetVoice(p, "elevenlabs", gender)!;
        expect(GEMINI_30).toContain(gv);
        expect(ELEVEN).toContain(ev);
        expect(voiceInfo("google/gemini-3.8-flash-tts", gv).gender).toBe(gender);
        expect(voiceInfo("elevenlabs/eleven-v3", ev).gender).toBe(gender);
      }
    }
  });
});
