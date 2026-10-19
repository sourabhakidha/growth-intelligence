// October 2026 creative launch list, as supplied by the business on 18 Oct 2026. AUTHORITATIVE for which creatives are
// new in October: every live creative NOT on this list launched before October. The list gives names only, so the
// launch DAY is still the first day of delivery in Meta.
//
// Each list item is mapped to the Meta ad names that carry it. "exact" = the ad name clearly names the creative;
// "probable" = matched by theme and launch batch (please correct if wrong). Items with no Meta ad are not live on Meta
// (e.g. billboards, metro / train banners, videos not yet launched) and are never guessed. Pure data, no imports.

export type CreativeFormat = "Static" | "Video";

export interface OctCreative {
  name: string;
  /** From the file extension in the list, else from the ad-name prefix (App_Static_ / App_Video_ / UGC). */
  format: CreativeFormat | null;
  ads: string[];
  match: "exact" | "probable" | "none";
}

const c = (name: string, format: CreativeFormat | null, ads: string[], match: OctCreative["match"] = ads.length ? "exact" : "none"): OctCreative => ({
  name,
  format,
  ads,
  match,
});

export const OCT_CREATIVES: readonly OctCreative[] = [
  // 2 Oct batch — videos
  c("Auto Analogy", "Video", ["App_Video_Auto_Anology_021026"]),
  c("Google Map Analogy", "Video", ["App_Video_Creative_Test_Google_Map_Analogy_021026", "App_Video_Google_Map_Analogy_021026"]),
  c("Hallmark Analogy", "Video", ["App_Video_Creative_Test_Hallmark_Analogy_021026"]),
  c("Naam Ka Daam (Flight Analogy)", "Video", ["App_Video_Test_Naam_ka_Dam_021026"]),
  c("UGC 1", "Video", ["App_Video_Creative_Test_UGC_01_021026"]),
  c("UGC 9 - Mumbai Delivery", "Video", ["App_Video_Creative_Test_UGC_09_021026"]),
  c("UGC 10 - Mumbai Delivery 2", "Video", ["App_Creative_Test_UGC_10_021026"]),
  // 2 Oct batch — statics
  c("Brand Ka Naam", "Static", ["App_Static_Brand_Medicine_021026"], "probable"),
  c("Brand Yaad", "Static", ["App_Static_Brand_Salt_Kaunsa_021026"], "probable"),
  c("Dawai Same", "Static", ["App_Static_Dawai_Same_021026"]),
  c("Diabetes Ki Dawai Khatam", "Static", ["App_Static_Diabetes_Ki_Dawai_021026"]),
  c("Har Mahine 3000", "Static", ["App_Static_Har_Mahine_3000_021026"]),
  c("Last Tablet", "Static", ["App_Static_Last_Tablet_021026"]),
  c("Same Hai Ya Alag", "Static", ["App_Static_Ek_Likhi_Dusri_Mili_021026"], "probable"),
  c("Sehat Ka Khayal", "Static", ["App_Static_Sehat_Ka_Khayal_Budget_021026"]),
  // 5–8 Oct — videos
  c("Alpha Ketoanalogue Marathi", "Video", ["App_Creative_Test_Marathi_Alpha_Ketoanalouge_061026"]),
  c("UGC 3", "Video", ["App_Creative_Test_UGC_3_051026", "App_UGC_3_051026", "App_Video_UGC_3_051026"]),
  c("UGC 4", "Video", ["App_Creative_Test_UGC_4_061026"]),
  c("Apixaban Marathi", "Video", ["App_Video_Marathi_Apixaban_081026"]),
  c("Nintedanib Marathi 1", "Video", ["App_Video_Marathi_Nintedanib_1_081026"]),
  c("Nintedanib Marathi 2", "Video", ["App_Video_Marathi_Nintedanib_2_081026"]),
  c("Vimla Objections V2", "Video", ["App_Video_Vimla_Objection_041026"], "probable"),
  // 9 Oct batch — statics
  c("1000 Families", "Static", ["App_Static_10000+_Families_091026"], "probable"),
  c("Bill Savings", "Static", ["App_Static_Bill_Saving_091026"]),
  c("Both Work the Same", "Static", ["App_Static_Same_Bp_ki_Dawa_091026"], "probable"),
  c("ChatGPT", "Static", ["App_Static_ChatGpt_Asking_021026"]),
  c("Jan Aushadhi", "Static", ["App_Static_Jan_Aushadhi_091026"]),
  c("Mumbai Delivery", "Static", ["App_Static_24_Delivery_091026"], "probable"),
  c("Packaging Orange", null, []),
  c("Savings Daam Sahi", "Static", ["App_Static_Dawa_Sahi_091026"], "probable"),
  c("Why Switch", "Static", ["App_Static_Why_Akidha_091026"], "probable"),
  c("Zyada Paisa Kyun", null, []),
  c("Fixing Your Bill", "Static", ["App_Static_Fix_Med_Bills_151026"], "probable"),
  c("Marketing Branding", null, []),
  c("Naam Alag Kaam Wohi", "Static", ["App_Static_Dont_Pay_For_Name_091026"], "probable"),
  c("Questions", null, []),
  c("Substitutes Discount", null, []),
  c("Substitutes Discount (Marathi)", null, []),
  c("What Are You Paying For", "Static", ["App_Static_Pay_For_Medicine_091026"], "probable"),
  c("Marathi_Savings", "Video", ["App_Marathi_Saving_131026"], "probable"),
  // 15 Oct batch — statics (.jpg)
  c("big medicine bill.jpg", "Static", ["App_Static_Big_Savings_151026"], "probable"),
  c("common savings on medicine.jpg", "Static", ["App_Static_Start_Saving_151026"], "probable"),
  c("heavy bill.jpg", "Static", ["App_Static_Heavy_Bills_151026"]),
  c("Marathi metformin 500mg.jpg", "Static", ["App_Static_Marathi_High_Bills_Metformin_500_151026"]),
  c("Marathi mumbai never sleeps.jpg", "Static", ["App_Static_Marathi_24-48_Delivery_151026"], "probable"),
  c("marathi rosuvastatin 20mg.jpg", "Static", ["App_Static_Marathi_High_Bills_Rosuvastatin_151026"]),
  c("marathi telmisartan 20mg.jpg", "Static", ["App_Static_Marathi_High_Bills_Telmisartan_151026"]),
  c("Metformin 500 mg.jpg", "Static", ["App_Static_High_Medicine_Bills_Metformin_151026"]),
  c("mumbai never sleeps.jpg", "Static", ["App_Static_24-48_Delivery_Mumbai_151026"], "probable"),
  c("Rosuvastatin 20 mg.jpg", "Static", ["App_Static_High_Medicine_Bills_Rosuvastatin_151026"]),
  c("Stop overpaying.jpg", "Static", ["App_Static_Why_PayMore_151026"], "probable"),
  c("Substitute Medicines.jpg", "Static", ["App_Static_24-48_Delivery_70%Off_151026"], "probable"),
  c("Tablet bros.jpg", "Static", []),
  c("unlock savings.jpg", "Static", ["App_Static_Unlock_Kijye_151026"], "probable"),
  c("Zyada kyu pay kiya.jpg", "Static", ["App_Static_Old_Lady_Zayada_Pay_Kyun_Kiya_151026"]),
  c("Zyada paise kyu.jpg", "Static", ["App_Static_Zayada_Paise_Kyun_151026"]),
  // 15 Oct batch — videos (.mp4)
  c("UGC 7_Convenience .mp4", "Video", ["App_Creative_Test_UGC_7_151026"]),
  c("UGC 6_ Authority.mp4", "Video", ["App_Creative_Test_UGC_6_151026"]),
  c("UGC 5_Caregiver.mp4", "Video", ["App_Creative_Test_UGC_5_151026"]),
  c("Marathi_savings2.mp4", "Video", []),
  c("Mumbai_Delivery.mp4", "Video", []),
  c("Mumbai_traffic.mp4", "Video", []),
  c("Savings_Delivery.mp4", "Video", []),
  c("Savings_jar.mp4", "Video", []),
  c("Akidha UGC 8_Caregiver .mp4", "Video", []),
  c("Akidha UGC 11_Savings.mp4", "Video", []),
  // Offline / OOH artwork — not expected on Meta
  ...["Billboard_1.jpg", "Billboard_2.jpg", "BP_Tissue ver.jpg", "Metro Ver1.jpg", "Metro Ver2.jpg", "Metro Ver3.jpg", "Metro Ver4.jpg", "Train bahnner_1.jpg", "Train bahnner_2.jpg", "Why branded_1.jpg", "Why branded_2.jpg", "Yearly_Tissue ver.jpg"].map((n) =>
    c(n, "Static", []),
  ),
];

/** Flexible / multi-creative ads mix several creatives in one ad, so they cannot be credited to one creative. */
export const MIXED_CREATIVE_AD = /flexi|multiads|multivideoad|mutlivideoad/i;

const byAd = new Map<string, OctCreative>();
for (const oc of OCT_CREATIVES) for (const ad of oc.ads) byAd.set(ad, oc);

export type Cohort = "oct" | "pre_oct" | "mixed";

export interface CreativeIdentity {
  key: string;
  cohort: Cohort;
  format: CreativeFormat | null;
  match: OctCreative["match"] | null;
}

/** Creative identity of a Meta ad name: the October list item it carries, a mixed ad, or a pre-October creative. */
export function creativeOf(adName: string): CreativeIdentity {
  const oc = byAd.get(adName);
  if (oc) return { key: oc.name, cohort: "oct", format: oc.format, match: oc.match };
  if (MIXED_CREATIVE_AD.test(adName)) return { key: adName, cohort: "mixed", format: null, match: null };
  const format: CreativeFormat | null = /^app_static_/i.test(adName) ? "Static" : /video|ugc/i.test(adName) ? "Video" : null;
  return { key: adName, cohort: "pre_oct", format, match: null };
}
