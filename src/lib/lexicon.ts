/**
 * A small English → Bangla word list for checking English claims against a Bangla story.
 *
 * Used only for "anchors": checkable words in a claim (people, places, everyday things). If a
 * claim names a place or thing, the passage it cites should mention it too. This is a generic
 * list for Bangla village / family stories — it is not written for any one story.
 *
 * `bn` forms are matched as whole words; forms of 3+ letters also match as the start of a word
 * (ফোন → ফোনে, ফোনটা).
 */
export type AnchorKind = "person" | "place" | "thing";

export interface Alias {
  en: string[];
  bn: string[];
  kind: AnchorKind;
}

const t = (en: string, bn: string, kind: AnchorKind = "thing"): Alias => ({ en: en.split("|"), bn: bn.split("|"), kind });

export const LEXICON: Alias[] = [
  // places (a place the story never names, while the passage names another, is a contradiction)
  t("dhaka", "ঢাকা|ঢাকায়", "place"),
  t("malaysia", "মালয়েশিয়া|মালয়েশিয়ায়|মালয়েশিয়ার", "place"),
  t("kuala lumpur", "কুয়ালালামপুর", "place"),
  t("bogura|bogra", "বগুড়া|বগুড়ার", "place"),
  t("shibganj", "শিবগঞ্জ|শিবগঞ্জের", "place"),
  t("naogaon", "নওগাঁ|নওগাঁর", "place"),
  t("chittagong|chattogram", "চট্টগ্রাম|চট্টগ্রামে", "place"),
  t("sylhet", "সিলেট|সিলেটে", "place"),
  t("khulna", "খুলনা|খুলনায়", "place"),
  t("rajshahi", "রাজশাহী|রাজশাহীতে", "place"),
  t("barishal|barisal", "বরিশাল|বরিশালে", "place"),
  t("rangpur", "রংপুর|রংপুরে", "place"),
  t("mymensingh", "ময়মনসিংহ", "place"),
  t("comilla|cumilla", "কুমিল্লা|কুমিল্লায়", "place"),
  t("kolkata|calcutta", "কলকাতা|কলকাতায়", "place"),
  t("india", "ভারত|ভারতে|ইন্ডিয়া", "place"),
  t("dubai", "দুবাই|দুবাইয়ে", "place"),
  t("saudi|saudi arabia", "সৌদি|সৌদিতে", "place"),
  t("qatar", "কাতার|কাতারে", "place"),
  t("oman", "ওমান|ওমানে", "place"),
  t("singapore", "সিঙ্গাপুর|সিঙ্গাপুরে", "place"),
  t("london", "লন্ডন|লন্ডনে", "place"),
  t("america|usa", "আমেরিকা|আমেরিকায়", "place"),
  t("italy", "ইতালি|ইতালিতে", "place"),
  t("japan", "জাপান|জাপানে", "place"),
  // family
  t("mother|mom|mum|amma", "মা|মায়ের|মাকে|মায়ের|আম্মা|আম্মার|আম্মারে|মায়ে"),
  t("father|dad|abba", "বাবা|বাবার|বাপ|বাপের|আব্বা|আব্বার"),
  t("son", "ছেলে|ছেলের|ছেলেকে|পোলা|পোলার|পোলাডা"),
  t("daughter", "মেয়ে|মেয়ের|মাইয়া"),
  t("husband", "স্বামী|স্বামীর|জামাই"),
  t("wife", "বউ|বৌ|স্ত্রী|বউয়ের"),
  t("brother", "ভাই|ভাইয়ের|ভাইয়া"),
  t("sister", "বোন|বোনের|আপা"),
  t("grandmother|grandma", "দাদি|নানি|দাদির|নানির"),
  t("grandfather|grandpa", "দাদা|নানা|দাদার|নানার"),
  t("grandson|grandchild", "নাতি|নাতির|নাতনি"),
  t("uncle", "চাচা|মামা|কাকা|খালু|চাচার|মামার"),
  t("aunt|khala", "খালা|খালার|চাচি|মামি|ফুপু"),
  // home and objects
  t("house", "বাড়ি|বাড়ির|বাসা|ঘর|ঘরে|ঘরের"),
  t("room|bedroom", "ঘর|ঘরে|ঘরের|ঘরটা|কামরা|রুম"),
  t("veranda|verandah|porch", "বারান্দা|বারান্দায়|বারান্দার"),
  t("courtyard|yard", "উঠোন|উঠান|উঠোনে"),
  t("mosque", "মসজিদ|মসজিদের"),
  t("market|bazaar", "বাজার|বাজারে|হাট"),
  t("office", "অফিস|অফিসে"),
  t("airport", "এয়ারপোর্ট|এয়ারপোর্টে|বিমানবন্দর"),
  t("village", "গ্রাম|গ্রামে|গ্রামের"),
  t("school", "স্কুল|স্কুলে|বিদ্যালয়"),
  t("hospital", "হাসপাতাল|হাসপাতালে"),
  t("fan|ceiling fan", "ফ্যান|ফ্যানটা|পাখা"),
  t("hand fan|palm fan|palm-leaf fan", "পাখা|তালপাতার"),
  t("meter", "মিটার|মিটারে|মিটারের"),
  t("bill", "বিল|বিলের|বিলটা"),
  t("unit|units", "ইউনিট"),
  t("taka|money", "টাকা|টাকাটা|পয়সা"),
  t("phone|call|calls|called|calling|video call|mobile", "ফোন|ফোনে|ফোনটা|মোবাইল|কল"),
  t("message|text|sms", "মেসেজ|মেসেজটা|এসএমএস"),
  t("notebook|ledger|book", "খাতা|খাতায়|খাতাটাকে|খাতার"),
  t("calendar", "ক্যালেন্ডার|ক্যালেন্ডারটা|ক্যালেন্ডারের"),
  t("lock|locked|padlock", "তালা"),
  t("bed", "খাট|খাটের|খাটটা|বিছানা"),
  t("mattress", "তোশক"),
  t("blanket|quilt", "কাঁথা|কম্বল|লেপ"),
  t("light|lamp|bulb", "বাতি|বাল্ব|লাইট|আলো"),
  t("dark|darkness", "অন্ধকার|অন্ধকারে"),
  t("window", "জানালা|জানালার"),
  t("door", "দরজা|দরজার"),
  t("switch", "সুইচ"),
  t("charger", "চার্জার|চার্জ"),
  t("tea", "চা"),
  t("tree|mango tree", "গাছ|গাছের|আমগাছ|আমগাছের"),
  t("passport", "পাসপোর্ট|পাসপোর্টের"),
  t("cataract|cataracts", "ছানি|ছানির"),
  t("eye|eyes", "চোখ|চোখে"),
  t("cow", "গরু|গাভী"),
  t("goat", "ছাগল"),
  t("chicken|hen", "মুরগি"),
  t("car", "গাড়ি|গাড়িতে"),
  t("sofa|couch", "সোফা"),
  t("television|tv", "টিভি|টেলিভিশন"),
  t("refrigerator|fridge", "ফ্রিজ"),
  t("letter", "চিঠি|চিঠির"),
  t("rain", "বৃষ্টি|বৃষ্টিতে"),
  t("night", "রাত|রাতে|রাইতে|রাত্রে"),
  t("november", "নভেম্বর"),
  t("eid", "ঈদ|ঈদে"),
  t("tin|tin-roofed", "টিন|টিনের"),
  t("electricity|power", "বিদ্যুৎ|বিদ্যুতের|কারেন্ট|কারেন্টের"),
];

const EN_NEGATION = /\b(not|never|no|nobody|no one|nothing|none|neither|nor|cannot|without)\b|n't\b/i;
/** "for no reason", "no matter" are not negations of what happened. */
const EN_IDIOM = /\b(for no (particular |real |special )?reason|no matter|no longer than)\b/gi;

/** Is this English claim negative (not / never / nobody / no call …)? */
export function enNegative(text: string): boolean {
  return EN_NEGATION.test(text.replace(EN_IDIOM, " "));
}
