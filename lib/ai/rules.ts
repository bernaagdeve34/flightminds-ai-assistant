export type NluType = "Arrival" | "Departure";
export interface NluResult {
  city?: string;
  type?: NluType;
  flightNumber?: string;
}

const CITY_ALIASES: Record<string, string[]> = {
  istanbul: ["istanbul", "ist", "ltf m", "ltfm"],
  ankara: ["ankara", "esb"],
  izmir: ["izmir", "adb"],
  adana: ["adana"],
  antalya: ["antalya"],
  diyarbakir: ["diyarbakır", "diyarbakir"],
  trabzon: ["trabzon"],
  kayseri: ["kayseri"],
  gaziantep: ["gaziantep"],
  van: ["van"],
  erzurum: ["erzurum"],
  samsun: ["samsun"],
  bodrum: ["bodrum", "bJV"],
  dalaman: ["dalaman"],
};

const ARRIVAL_WORDS = ["gelen", "varış", "varacak", "arrival", "arrive", "arrivals", "iniş"];
const DEPARTURE_WORDS = ["giden", "kalkış", "kalkacak", "departure", "depart", "uçuş", "kalkışlar"];

function detectType(q: string): NluType | undefined {
  const l = q.toLowerCase();
  if (ARRIVAL_WORDS.some((w) => l.includes(w))) return "Arrival";
  if (DEPARTURE_WORDS.some((w) => l.includes(w))) return "Departure";
  return undefined;
}

function detectCity(q: string): string | undefined {
  const l = q.toLowerCase();
  for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((a) => l.includes(a))) return canonical;
  }
  const m = l.match(/\b([a-zçğıöşü]{3,})\b/iu);
  return m?.[1];
}

function detectFlight(q: string): string | undefined {
  const m = q.match(/\b([a-zA-Z]{2}\s?\d{2,4})\b/);
  return m?.[1]?.replace(/\s+/, "");
}

export function extractQueryWithRules(query: string): NluResult {
  return {
    city: detectCity(query),
    type: detectType(query),
    flightNumber: detectFlight(query),
  };
}
