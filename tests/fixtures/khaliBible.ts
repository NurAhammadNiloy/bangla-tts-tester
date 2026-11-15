/** "খালি ঘরের ফ্যান": the author's original story and an AI answer shaped like the real model's. */
import { readFileSync } from "node:fs";
import { foldText, splitSentences } from "@/lib/storyEvidence";

export const STORY = readFileSync(new URL("./khali-ghorer-fan.txt", import.meta.url), "utf8");
/** Id of the first sentence containing `t`. */
export const S = (t: string) => {
  const hit = splitSentences(STORY).find((s) => foldText(s.text).includes(foldText(t)));
  if (!hit) throw new Error(`no sentence with ${t}`);
  return hit.id;
};

/** What the model sends back for this story (shape of BIBLE_SCHEMA). */
export const AI = () => ({
  message: "A lonely mother pays for an empty room's fan so her son abroad believes she is well; the meter reader learns to call his own mother.",
  characters: [
    { id: "rahima", name: "রহিমা খালা", mentions: ["রহিমা খালা", "খালা", "রহিমা বেগম"], relation: "Mizan's mother; widow; lives alone", look: "old village woman, white sari", facts: [
      { kind: "confirmed", text: "She has cataracts and sits in the dark, and wants it hidden from Mizan", source: "চোখে ছানি পড়ছে। আলো দিয়া আমার কাম নাই। কিন্তু ও যেন না জানে।", evidence: [S("চোখে ছানি পড়ছে")] },
    ] },
    { id: "mizan", name: "মিজান", mentions: ["মিজান"], relation: "Rahima's son; lives in Malaysia for six years", look: "man in his thirties", facts: [] },
    { id: "narrator", name: "মিটার রিডার (আমি)", mentions: ["আমি", "মিটার রিডার"], relation: "the meter reader telling the story; not Rahima's family", look: "man, 40s, with a ledger", facts: [] },
    { id: "hamida", name: "হামিদা খাতুন", mentions: ["হামিদা খাতুন"], relation: "the narrator's mother, lives in Naogaon", look: "old woman", facts: [] },
  ],
  relations: [
    { from: "rahima", to: "mizan", relation: "mother of", source: "আমি মিজান। রহিমা বেগমের ছেলে।", evidence: [S("রহিমা বেগমের ছেলে")] },
    { from: "hamida", to: "narrator", relation: "mother of", source: "আমার মায়ের বিল।", evidence: [S("আমার মায়ের বিল")] },
    { from: "narrator", to: "rahima", relation: "not related to (he reads her meter)", source: "", evidence: [S("আমি পল্লী বিদ্যুতের মিটার রিডার")] },
  ],
  places: [
    { id: "rahima_home", name: "Rahima Khala's home", kind: "house", part_of: "", description: "Behind the mosque; two tin-roofed rooms", who: "Rahima", source: "খালার বাড়ি মসজিদের পেছনে। টিনের দুটো ঘর।", evidence: [S("খালার বাড়ি মসজিদের পেছনে"), S("টিনের দুটো ঘর")] },
    { id: "locked_room", name: "The locked east room", kind: "room", part_of: "rahima_home", description: "Locked room with a bed, rolled mattress, old calendar and a ceiling fan running", who: "nobody", source: "ঘরে কেউ নেই।", evidence: [S("অন্ধকার ঘর"), S("ঘরে কেউ নেই")] },
  ],
  events: [
    // The eight claims the old checker wrongly called "maybe":
    { kind: "confirmed", text: "The narrator reads 9 units at Rahima Khala's house, and she asks him to write more", source: "প্রথম যেবার রিডিং নিতে গেলাম মাসে উঠেছে নয় ইউনিট", evidence: [S("প্রথম যেবার রিডিং")] },
    { kind: "confirmed", text: "Electricity consumption increases to 41 units", source: "পরের মাসে মিটারে উঠলো একচল্লিশ ইউনিট।", evidence: [S("একচল্লিশ ইউনিট")] },
    { kind: "confirmed", text: "Rahima runs a ceiling fan in the locked room", source: "", evidence: [S("তালা দিয়াই চালাই")] },
    { kind: "confirmed", text: "Mizan calls from Malaysia after four months", source: "চার মাস পর অফিসে একটা ফোন এলো... বিদেশি নম্বর।", evidence: [S("চার মাস পর")] },
    { kind: "confirmed", text: "Mizan recognizes the locked room as his former bedroom", source: "", evidence: [S("ঐটা আমার ঘর, ভাই")] },
    { kind: "confirmed", text: "The following month electricity consumption is 16 units", source: "ষোলো ইউনিট", evidence: [] },
    { kind: "confirmed", text: "The narrator receives his mother's electricity bill of 186 taka", source: "গ্রাহক: হামিদা খাতুন। চলতি মাসের বিল ১৮৬ টাকা।", evidence: [] },
    { kind: "confirmed", text: "The narrator calls his own mother simply to talk", source: "", evidence: [S("এমনি ফোন দিলাম")] },
  ],
  key_lines: [
    { text: "টাকা আমার যায় না।", speaker: "rahima" },
    { text: "ঐটা আমার ঘর ভাই", speaker: "mizan" },
    { text: "এমনি ফোন দিলাম", speaker: "narrator" },
  ],
  key_numbers: [
    { value: "নয় ইউনিট", meaning: "first reading" },
    { value: "একচল্লিশ", meaning: "after the fan" },
    { value: "ষোলো", meaning: "after the video calls" },
    { value: "১৮৬", meaning: "his mother's bill in taka" },
    { value: "ছয় ইউনিট", meaning: "his mother's use" },
  ],
  key_moments: [
    { part: 0, text: "Rahima asks for a higher reading", purpose: "the strange request", visible: ["rahima", "narrator"], objects: ["meter", "notebook"], tone: "puzzled", restrictions: [], source: "একটু বাড়ায়া লেখা যায় না?", evidence: [S("একটু বাড়ায়া লেখা যায় না")] },
    { part: 0, text: "The fan spins in the locked, empty room", purpose: "the discovery", visible: [], objects: ["ceiling fan", "calendar"], tone: "eerie, sad", restrictions: ["nobody inside the room"], source: "", evidence: [S("সিলিং ফ্যানটা পুরো গতিতে ঘুরছে")] },
    { part: 0, text: "Rahima fans herself with a palm-leaf fan in her dark room while the electric fan runs next door", purpose: "her sacrifice", visible: ["rahima"], objects: ["hand fan"], tone: "quiet", restrictions: [], source: "নিজের ঘরে তিনি তালপাতার পাখা হাতে বসে থাকতেন।", evidence: [] },
    { part: 0, text: "Mizan explains the airport and why he stopped calling", purpose: "his side", visible: ["narrator"], objects: ["office phone"], tone: "heavy", restrictions: ["Mizan is only a voice on the phone"], source: "", evidence: [S("কুয়ালালামপুর এয়ারপোর্টে")] },
    { part: 0, text: "Mizan realises it is his own room", purpose: "turning point", visible: ["narrator"], objects: ["phone"], tone: "breaking", restrictions: [], source: "ঐটা আমার ঘর, ভাই।", evidence: [] },
    { part: 0, text: "Rahima with the phone on her lap: he video-calls every night now", purpose: "repair", visible: ["rahima", "narrator"], objects: ["mobile phone", "charger"], tone: "warm", restrictions: [], source: "ও রাইতে ফোন দেয়। ভিডিও ফোন।", evidence: [] },
    { part: 0, text: "Rahima asks him to write only the small real use", purpose: "she no longer needs the lie", visible: ["rahima", "narrator"], objects: ["phone"], tone: "tender", restrictions: [], source: "ঐটুকুই লেখো।", evidence: [] },
    { part: 0, text: "The narrator sees his mother's 186-taka bill and six units", purpose: "the mirror", visible: ["narrator"], objects: ["phone message"], tone: "still", restrictions: [], source: "ছয় ইউনিট।", evidence: [S("চলতি মাসের বিল")] },
    { part: 0, text: "He calls his mother for no reason", purpose: "the change", visible: ["narrator"], objects: ["phone"], tone: "shy", restrictions: [], source: "এমনি ফোন দিলাম।", evidence: [] },
    { part: 0, text: "Final reflection about meters and unspent love", purpose: "meaning", visible: [], objects: ["meter"], tone: "quiet", restrictions: [], source: "", evidence: [S("মিটার গোনে কতটা বিদ্যুৎ"), S("ওটা জানতে হলে ফোন করতে হয়")] },
  ],
  ending: "Slow push in on the narrator on the phone, then fade to black.",
  ending_beats: [
    { kind: "confirmed", text: "His mother first thinks the call is about the bill", source: "কী হইছে? বিল দিস নাই?", evidence: [] },
    { kind: "confirmed", text: "He asks why she does not run her fan; she says November is cold and she needs a blanket", source: "", evidence: [S("নভেম্বর মাসে ফ্যান")] },
  ],
  final_line: "এমনি",
  pacing: "slow, long silences after the key lines",
  prohibited: [
    { kind: "prohibited_change", text: "The narrator never tells Mizan about Rahima's cataracts", source: "শুধু ছানির কথাটা বললাম না।", evidence: [S("শুধু ছানির কথাটা")], rule: { type: "never_says", who: "", other: "", place: "", terms: ["ছানি", "cataract"], when_present: ["mizan"] } },
    { kind: "prohibited_change", text: "Mizan never physically returns home", source: "", evidence: [], rule: { type: "never_present", who: "mizan", other: "", place: "", terms: [], when_present: [] } },
    { kind: "prohibited_change", text: "Mizan and Rahima never meet in person", source: "", evidence: [], rule: { type: "never_together", who: "mizan", other: "rahima", place: "", terms: [], when_present: [] } },
    { kind: "prohibited_change", text: "No physical reunion is shown, only video calls", source: "", evidence: [], rule: { type: "none", who: "", other: "", place: "", terms: [], when_present: [] } },
  ],
});

