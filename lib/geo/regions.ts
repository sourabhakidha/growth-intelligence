// Regional hierarchy for Fresh orders, resolved from the order's pincode (Order_Level_V4."pinCode"). Pure data and
// logic — no imports — so it can be unit-tested and validated against live orders (scripts/validate-regions.mts).
//
// Hierarchy (first match wins, so every order lands in exactly one group) — agreed 18 Oct 2026:
//   1. Priority Mumbai pincodes  — the business-supplied list below (same set as crm.zone_pincodes MMR + 2 codes)
//   2. Tier 1                    — rest of MMR (incl. Mira-Bhayandar), Pune (+ Pimpri-Chinchwad), Kolkata (+ Howrah),
//                                  Hyderabad (+ Secunderabad), Ahmedabad, Chennai, Bangalore, Surat
//   3. Delhi NCR                 — Delhi, Gurugram, Noida & Greater Noida, Ghaziabad, Faridabad (own group)
//   4. Tier 2                    — established Tier 2 cities: the Government of India Y-class (HRA) city list, plus
//                                  Satara, Ahmednagar, Akola, Chandrapur, Buldhana, Ratnagiri, Dhule, Latur and Udaipur
//                                  as named by the business
//   5. Tier 3                    — every other valid Indian pincode: smaller cities, peripheral markets, outlier pockets
//   6. Location not verified     — pincode missing or not a valid Indian pincode. Never shown as Tier 3, and never
//                                  listed pincode-by-pincode on the dashboard.
//
// Watch markets (WATCH_AREAS) are highlighted whenever they get orders: Surat (high RTO) and Visakhapatnam.
//
// Tier 1, Delhi NCR and a few Tier 2 cities are matched on city-level pincode ranges. Other Tier 2 cities are matched
// when the order's city text names the city AND the pincode is in that state's postal circle, so e.g. Aurangabad
// (Bihar) never matches Aurangabad (Maharashtra). Peripheral orders whose city text is a district name can land in
// Tier 2; npm run validate:regions reports how the mapping lines up with the order data.

export type RegionTier = "priority_mumbai" | "tier_1" | "delhi_ncr" | "tier_2" | "tier_3" | "unverified";

export const TIER_ORDER: readonly RegionTier[] = ["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3", "unverified"];

export const TIER_LABEL: Record<RegionTier, string> = {
  priority_mumbai: "Priority Mumbai pincodes",
  tier_1: "Tier 1",
  delhi_ncr: "Delhi NCR",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
  unverified: "Location not verified",
};

/** Market view (requirement F): Mumbai vs other metros vs smaller regional markets. */
export type MarketGroup = "mumbai" | "other_metros" | "tier_2" | "smaller_markets" | "unverified";

export const MARKET_LABEL: Record<MarketGroup, string> = {
  mumbai: "Mumbai (priority pincodes + rest of MMR)",
  other_metros: "Other metros (other Tier 1 cities + Delhi NCR)",
  tier_2: "Tier 2 cities",
  smaller_markets: "Smaller regional markets (Tier 3)",
  unverified: "Location not verified",
};

/** Priority Mumbai pincodes as supplied by the business on 18 Oct 2026 (200 codes, kept exactly as given). */
export const PRIORITY_MUMBAI_PINCODES: ReadonlySet<string> = new Set(
  (
    "400000,400001,400002,400003,400004,400005,400006,400007,400008,400009,400010,400011,400012,400013,400014,400015," +
    "400016,400017,400018,400019,400020,400021,400022,400023,400024,400025,400026,400027,400028,400029,400030,400031," +
    "400032,400033,400034,400035,400036,400037,400038,400039,400040,400041,400042,400043,400044,400046,400047,400048," +
    "400049,400050,400051,400052,400053,400054,400055,400056,400057,400058,400059,400060,400061,400062,400063,400064," +
    "400065,400066,400067,400068,400069,400070,400071,400072,400073,400074,400075,400076,400077,400078,400079,400080," +
    "400081,400082,400083,400084,400085,400086,400087,400088,400089,400090,400091,400092,400093,400094,400095,400096," +
    "400097,400098,400099,400100,400101,400102,400103,400104,400105,400106,400107,400108,400109,400110,400111,400112," +
    "400113,400114,400162,400167,400202,400401,400410,400547,400601,400602,400603,400604,400605,400606,400607,400608," +
    "400610,400611,400612,400613,400614,400615,400700,400701,400703,400705,400706,400708,400709,400710,400713,400901," +
    "401016,401100,401101,401104,401105,401106,401107,401200,401201,401202,401203,401207,401208,401209,401302,401303," +
    "401305,401403,401404,401407,402225,404502,410107,410209,410210,410218,410303,410708,421001,421002,421003,421004," +
    "421005,421006,421032,421051,421102,421103,421201,421202,421203,421204,421205,421206,421301,421302,421303,421305," +
    "421306,421501,421502,421503,421505,421507,989898,999992"
  ).split(","),
);

/** Tier 1 cities as agreed with the business (MMR outside the priority list is Tier 1 too). */
export const TIER_1_CITIES = [
  "MMR", "Pune", "Pimpri-Chinchwad", "Kolkata", "Howrah", "Hyderabad", "Secunderabad", "Ahmedabad", "Chennai", "Bangalore", "Surat",
] as const;

/** Markets to highlight whenever they receive orders, with the reason. */
export const WATCH_AREAS: Readonly<Record<string, string>> = {
  Surat: "Not targeted — high RTO",
  Visakhapatnam: "Not targeted",
};

export interface ResolvedLocation {
  tier: RegionTier;
  market: MarketGroup;
  /** City or area name within the tier, e.g. "Thane", "Gurugram", "Kolhapur", "Latur area (413xxx)". */
  area: string;
  /** Metro city the order counts towards in the metro ranking (Tier 1 and Delhi NCR); null otherwise. */
  metroCity: string | null;
}

const VALID_PIN = /^[1-8]\d{5}$/;

/** Mumbai-area clusters — same pincode ranges as the database function public.f_mumbai48_cluster(). */
export function mumbaiCluster(pin: string): string | null {
  const p = pin;
  if (p >= "400001" && p <= "400104") return "Mumbai";
  if (p >= "400601" && p <= "400615") return "Thane";
  if (p >= "400701" && p <= "400710") return "Navi Mumbai";
  if (p >= "410206" && p <= "410222") return "Panvel & Kharghar";
  if (p >= "421201" && p <= "421204") return "Dombivli";
  if (["421301", "421303", "421306", "421102", "421103"].includes(p)) return "Kalyan";
  if ((p >= "401101" && p <= "401107") || p === "401171") return "Mira-Bhayandar";
  if ((p >= "401201" && p <= "401212") || (p >= "401301" && p <= "401305")) return "Vasai-Virar";
  if (["421302", "421305", "421308", "421311"].includes(p)) return "Bhiwandi";
  if (p >= "421001" && p <= "421005") return "Ulhasnagar";
  if (p >= "421501" && p <= "421506") return "Ambernath & Badlapur";
  return null;
}

/** Fallback MMR area names for pincodes outside the named clusters. */
function mmrArea(pin: string): string {
  const named = mumbaiCluster(pin);
  if (named) return named;
  if (pin.startsWith("400")) return "Mumbai, Thane & Navi Mumbai (other)";
  if (pin.startsWith("401")) return "Palghar & Vasai (other)";
  if (pin.startsWith("421")) return "Thane district (other)";
  return "Raigad (Panvel, Uran, Karjat, Alibag)";
}

/** MMR (Mumbai belt): 400xxx, 401xxx, 421xxx, Raigad 402xxx and 410101–410299. Excludes the Pune-district 4103xx+. */
function isMmr(pin: string): boolean {
  return /^(400|401|421|402)/.test(pin) || (pin >= "410101" && pin <= "410299");
}

const has = (city: string, re: RegExp) => re.test(city);

function delhiNcrArea(pin: string): string | null {
  if (pin.startsWith("110")) return "Delhi";
  if (pin.startsWith("122")) return "Gurugram";
  if (pin.startsWith("2013") || (pin >= "203201" && pin <= "203209")) return "Noida & Greater Noida"; // incl. Dadri / Greater Noida
  if (pin.startsWith("201")) return "Ghaziabad";
  if (pin.startsWith("1210")) return "Faridabad";
  return null;
}

/** Tier 1 cities other than MMR, by city-level pincode ranges (city text only splits areas that share pincodes). */
function tier1Area(pin: string, city: string): string | null {
  if (pin.startsWith("411") || (pin.startsWith("412") && has(city, /pune|pimpri|chinchwad|pcmc/))) {
    return has(city, /pimpri|chinchwad|pcmc|bhosari|nigdi|akurdi/) ? "Pimpri-Chinchwad" : "Pune";
  }
  if (pin.startsWith("700")) return "Kolkata";
  if (pin.startsWith("7111") || pin.startsWith("7112")) return "Howrah";
  if (pin.startsWith("500")) return has(city, /secunderabad/) ? "Secunderabad" : "Hyderabad";
  if (pin.startsWith("380") || (pin.startsWith("382") && has(city, /ahmedabad/))) return "Ahmedabad";
  if (pin.startsWith("600")) return "Chennai";
  if (pin.startsWith("560") || (pin.startsWith("562") && has(city, /bangalore|bengaluru/))) return "Bangalore";
  if (pin.startsWith("395") || (pin.startsWith("394") && has(city, /surat/))) return "Surat";
  return null;
}

/** Tier 2 cities with city-level pincode ranges (no city text needed). */
function tier2ByPin(pin: string, city: string): string | null {
  if (pin.startsWith("302")) return "Jaipur";
  if (pin.startsWith("226")) return "Lucknow";
  if (pin.startsWith("462")) return "Bhopal";
  if (pin.startsWith("452")) return "Indore";
  if (pin.startsWith("800")) return "Patna";
  if (pin.startsWith("440") || (pin.startsWith("441") && has(city, /nagpur/))) return "Nagpur";
  if (pin.startsWith("390")) return "Vadodara";
  if (pin.startsWith("160") && !(pin >= "160055" && pin <= "160071")) return "Chandigarh"; // 160055–160071 = Mohali
  if (pin.startsWith("530")) return "Visakhapatnam";
  return null;
}

// Postal circles (first digits of the pincode) used to confirm a Tier 2 city's state.
const MH = /^4[0-4]/;
const GJ = /^3[6-9]/;
const RJ = /^3[0-4]/;
const MP = /^4[5-8]/;
const CG = /^49/;
const UP = /^2[0-8]/;
const PB = /^1[4-6]/;
const HR = /^1[23]/;
const HP = /^17/;
const JK = /^1[89]/;
const BR_JH = /^8[0-5]/;
const OD = /^7[5-7]/;
const WB = /^7[0-4]/;
const AS = /^78/;
const TG = /^50/;
const AP = /^5[1-3]/;
const KA = /^5[6-9]/;
const TN = /^6[0-4]/;
const KL = /^6[7-9]/;

/**
 * Established Tier 2 cities matched by city text + postal circle: Government of India Y-class (HRA) cities, plus
 * Satara (named by the business). Cities already in Tier 1, Delhi NCR or MMR are not repeated here.
 */
const TIER_2_BY_TEXT: readonly [name: string, circle: RegExp, text: RegExp][] = [
  // Maharashtra & Goa
  ["Aurangabad", MH, /\b(aurangabad|sambhajinagar)\b/], ["Nashik", MH, /\b(nashik|nasik)\b/], ["Solapur", MH, /\b(solapur|sholapur)\b/],
  ["Kolhapur", MH, /\bkolhapur\b/], ["Sangli", MH, /\b(sangli|miraj)\b/], ["Satara", MH, /\bsatara\b/], ["Nanded", MH, /\bnanded\b/],
  ["Amravati", MH, /\bamravati\b/], ["Jalgaon", MH, /\bjalgaon\b/], ["Goa", /^403/, /\b(goa|panaji|panjim|margao|madgaon|vasco|mapusa)\b/],
  // Added by the business on 18 Oct 2026 (larger markets outside the Y-class list)
  ["Ahmednagar", MH, /\b(ahmednagar|ahmadnagar|ahilyanagar)\b/], ["Akola", MH, /\bakola\b/], ["Chandrapur", MH, /\bchandrapur\b/],
  ["Buldhana", MH, /\b(buldhana|buldana)\b/], ["Ratnagiri", MH, /\bratnagiri\b/], ["Dhule", MH, /\bdhule\b/], ["Latur", MH, /\blatur\b/],
  // Gujarat, Rajasthan
  ["Rajkot", GJ, /\brajkot\b/], ["Bhavnagar", GJ, /\bbhavnagar\b/], ["Jamnagar", GJ, /\bjamnagar\b/], ["Anand", GJ, /\banand\b/],
  ["Jodhpur", RJ, /\bjodhpur\b/], ["Udaipur", RJ, /\budaipur\b/], ["Kota", RJ, /\bkota\b/], ["Ajmer", RJ, /\bajmer\b/], ["Bikaner", RJ, /\bbikaner\b/],
  // Madhya Pradesh, Chhattisgarh
  ["Gwalior", MP, /\bgwalior\b/], ["Jabalpur", MP, /\bjabalpur\b/], ["Ujjain", MP, /\bujjain\b/], ["Ratlam", MP, /\bratlam\b/],
  ["Raipur", CG, /\braipur\b/], ["Bhilai-Durg", CG, /\b(bhilai|durg)\b/], ["Bilaspur", CG, /\bbilaspur\b/],
  // Uttar Pradesh, Uttarakhand
  ["Kanpur", UP, /\bkanpur\b/], ["Agra", UP, /\bagra\b/], ["Varanasi", UP, /\b(varanasi|banaras|benares)\b/],
  ["Prayagraj", UP, /\b(prayagraj|allahabad)\b/], ["Meerut", UP, /\bmeerut\b/], ["Bareilly", UP, /\bbareilly\b/],
  ["Moradabad", UP, /\bmoradabad\b/], ["Aligarh", UP, /\baligarh\b/], ["Gorakhpur", UP, /\bgorakhpur\b/], ["Jhansi", UP, /\bjhansi\b/],
  ["Mathura", UP, /\bmathura\b/], ["Firozabad", UP, /\bfirozabad\b/], ["Dehradun", /^24[89]/, /\b(dehradun|dehra dun)\b/],
  // North
  ["Ludhiana", PB, /\bludhiana\b/], ["Amritsar", PB, /\bamritsar\b/], ["Jalandhar", PB, /\b(jalandhar|jullundur)\b/],
  ["Karnal", HR, /\bkarnal\b/], ["Shimla", HP, /\bshimla\b/], ["Jammu", JK, /\bjammu\b/], ["Srinagar", JK, /\bsrinagar\b/],
  // East & North-East
  ["Ranchi", BR_JH, /\branchi\b/], ["Jamshedpur", BR_JH, /\bjamshedpur\b/], ["Dhanbad", BR_JH, /\bdhanbad\b/], ["Bokaro", BR_JH, /\bbokaro\b/],
  ["Bhubaneswar", OD, /\bbhubaneswar\b/], ["Cuttack", OD, /\bcuttack\b/], ["Rourkela", OD, /\brourkela\b/],
  ["Asansol", WB, /\basansol\b/], ["Durgapur", WB, /\bdurgapur\b/], ["Siliguri", WB, /\bsiliguri\b/], ["Guwahati", AS, /\bguwahati\b/],
  // South
  ["Warangal", TG, /\b(warangal|hanamkonda)\b/], ["Vijayawada", AP, /\bvijayawada\b/], ["Guntur", AP, /\bguntur\b/], ["Nellore", AP, /\bnellore\b/],
  ["Kurnool", AP, /\bkurnool\b/], ["Kakinada", AP, /\bkakinada\b/], ["Rajahmundry", AP, /\b(rajahmundry|rajamahendravaram)\b/],
  ["Mysuru", KA, /\b(mysore|mysuru)\b/], ["Mangaluru", KA, /\b(mangalore|mangaluru)\b/], ["Hubballi-Dharwad", KA, /\b(hubli|hubballi|dharwad)\b/],
  ["Belagavi", KA, /\b(belgaum|belagavi)\b/], ["Kalaburagi", KA, /\b(gulbarga|kalaburagi)\b/], ["Vijayapura", KA, /\b(bijapur|vijayapura)\b/],
  ["Coimbatore", TN, /\bcoimbatore\b/], ["Madurai", TN, /\bmadurai\b/], ["Tiruchirappalli", TN, /\b(trichy|tiruchirappalli|tiruchirapalli)\b/],
  ["Salem", TN, /\bsalem\b/], ["Tirunelveli", TN, /\btirunelveli\b/], ["Erode", TN, /\berode\b/], ["Vellore", TN, /\bvellore\b/],
  ["Tiruppur", TN, /\b(tiruppur|tirupur)\b/], ["Thanjavur", TN, /\bthanjavur\b/], ["Puducherry", /^605/, /\b(pondicherry|puducherry)\b/],
  ["Kochi", KL, /\b(kochi|cochin|ernakulam)\b/], ["Thiruvananthapuram", KL, /\b(trivandrum|thiruvananthapuram)\b/],
  ["Kozhikode", KL, /\b(kozhikode|calicut)\b/], ["Thrissur", KL, /\b(thrissur|trichur)\b/], ["Kollam", KL, /\bkollam\b/],
  ["Kannur", KL, /\bkannur\b/], ["Malappuram", KL, /\bmalappuram\b/], ["Palakkad", KL, /\b(palakkad|palghat)\b/],
];

export const TIER_2_CITIES = [
  "Jaipur", "Lucknow", "Bhopal", "Indore", "Patna", "Nagpur", "Vadodara", "Chandigarh", "Visakhapatnam",
  ...TIER_2_BY_TEXT.map(([name]) => name),
] as const;

function tier2Area(pin: string, city: string): string | null {
  const byPin = tier2ByPin(pin, city);
  if (byPin) return byPin;
  if (!city) return null;
  for (const [name, circle, text] of TIER_2_BY_TEXT) if (circle.test(pin) && text.test(city)) return name;
  return null;
}

/** Normalised city text used only for area refinement and validation (never displayed raw). */
export function normCity(city: unknown): string {
  return typeof city === "string" ? city.trim().toLowerCase() : "";
}

export function normPin(pin: unknown): string {
  return typeof pin === "string" || typeof pin === "number" ? String(pin).trim() : "";
}

/** Tier 3 areas are grouped by 3-digit postal sorting district; the label is filled in by the caller. */
export function tier3AreaKey(pin: string): string {
  return `${pin.slice(0, 3)}xxx`;
}

export function resolveLocation(pinRaw: unknown, cityRaw: unknown): ResolvedLocation {
  const pin = normPin(pinRaw);
  const city = normCity(cityRaw);
  if (PRIORITY_MUMBAI_PINCODES.has(pin)) {
    // Codes on the list that are not standard pincodes (e.g. 989898) or fall outside the MMR ranges stay Priority,
    // under a neutral area name rather than a guessed locality.
    const area = VALID_PIN.test(pin) && isMmr(pin) ? mmrArea(pin) : "Other priority pincodes";
    return { tier: "priority_mumbai", market: "mumbai", area, metroCity: area === "Other priority pincodes" ? null : area };
  }
  if (!VALID_PIN.test(pin)) return { tier: "unverified", market: "unverified", area: TIER_LABEL.unverified, metroCity: null };
  if (isMmr(pin)) {
    const area = mmrArea(pin);
    return { tier: "tier_1", market: "mumbai", area, metroCity: area };
  }
  const t1 = tier1Area(pin, city);
  if (t1) return { tier: "tier_1", market: "other_metros", area: t1, metroCity: t1 };
  const ncr = delhiNcrArea(pin);
  if (ncr) return { tier: "delhi_ncr", market: "other_metros", area: ncr, metroCity: ncr };
  const t2 = tier2Area(pin, city);
  if (t2) return { tier: "tier_2", market: "tier_2", area: t2, metroCity: null };
  return { tier: "tier_3", market: "smaller_markets", area: tier3AreaKey(pin), metroCity: null };
}
