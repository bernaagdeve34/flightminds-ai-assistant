import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import type { Flight, FlightDirection } from "@/lib/types";
import { extractQueryWithGroq } from "@/lib/ai/groq";
import { groqChatSmart } from "@/lib/ai/groqChatSmart";
import { extractQueryWithRules } from "@/lib/ai/rules";
import { readJson } from "@/lib/diskCache";
import { IST_ALLOWED_PAGES } from "@/lib/content/istPages";

// Simple in-memory cache for RAG answers (resets on redeploy)
const ragCache = new Map<string, { at: number; answer: string }>();
// Quick response cache for repeated questions (5 minutes)
const quickRespCache = new Map<string, { at: number; data: any }>();
const QUICK_RESP_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Live flights in-memory cache (speeds up repeated flight queries)
let liveFlightsCache: { at: number; flights: Flight[] } | null = null;
const FLIGHT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// DB flights in-memory cache (5 minutes)
let dbCache: { at: number; flights: Flight[] } | null = null;
async function fetchFlightsFromDbCached(): Promise<Flight[]> {
  if (dbCache && (Date.now() - dbCache.at) < 5 * 60 * 1000) return dbCache.flights;
  const f = await fetchFlightsFromDb();
  dbCache = { at: Date.now(), flights: f };
  return f;
}

// FAQ cache (CSV: genelsorular.csv)
type FaqItem = { q: string; a: string; q_en?: string; a_en?: string };
let faqCache: Array<FaqItem> | null = null;
const DEFAULT_FAQ_SHEET_URL = "https://docs.google.com/spreadsheets/d/1UxFlL8OcXz0l9i8VpuiPZOcq6YKlkPPEKe9paBg4oXc/export?format=csv&gid=0";
// Lightweight memoization for normalizeText
const normCache = new Map<string, string>();
function normalizeText(s: string, lang: "tr" | "en"): string {
  const key = `${lang}|${s}`;
  const hit = normCache.get(key);
  if (hit) return hit;
  const out = (s || "")
    .toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    // domain-specific canonical forms
    .replace(/\bwi[\s-]?fi\b/g, "wifi")
    .replace(/\bkio?sk\w*\b/g, "kiosk")
    .replace(/\bfast\s*track\b/g, "fasttrack")
    .replace(/\botopark\b/g, "parking")
    .replace(/\bparking\b/g, "parking")
    .replace(/\babonelik\w*\b/g, "subscription")
    .replace(/\bsubscription\b/g, "subscription");
  normCache.set(key, out);
  if (normCache.size > 200) normCache.clear();
  return out;
}
function parseCsvFlexible(csv: string): FaqItem[] {
  // Robust CSV parser supporting commas and newlines inside quotes
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      // Handle escaped quotes inside quoted field
      if (inQuotes && csv[i+1] === '"') { field += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ',') { cur.push(field); field = ""; continue; }
    if (!inQuotes && (ch === '\n')) {
      cur.push(field); field = "";
      // Trim trailing \r if present
      if (cur.length === 1 && cur[0].trim() === "") { cur = []; continue; }
      rows.push(cur.map(s => s.replace(/^\s+|\s+$/g, ""))); cur = []; continue;
    }
    if (!inQuotes && ch === '\r') { continue; }
    field += ch;
  }
  // push last field/row
  cur.push(field);
  if (cur.some(s => s.trim().length)) rows.push(cur.map(s => s.replace(/^\s+|\s+$/g, "")));
  if (!rows.length) return [];
  const hdr = rows[0].map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const idxQ = hdr.findIndex(h => /^(sorular|soru|question|questions)$/.test(h));
  const idxA = hdr.findIndex(h => /^(cevaplar|cevap|answer|answers)$/.test(h));
  // Support both suffix _en and prefix en_
  const idxQEn = hdr.findIndex(h => /^(sorular_en|soru_en|question_en|questions_en|en_sorular|en_soru|en_question|en_questions)$/.test(h));
  const idxAEn = hdr.findIndex(h => /^(cevaplar_en|cevap_en|answer_en|answers_en|en_cevaplar|en_cevap|en_answer|en_answers)$/.test(h));
  const out: FaqItem[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const get = (idx: number) => idx >= 0 ? (cols[idx] ?? "").replace(/^"|"$/g, "").trim() : "";
    const q = idxQ >= 0 ? get(idxQ) : (cols[0] ?? "").trim();
    const a = idxA >= 0 ? get(idxA) : (cols.slice(1).join(",") ?? "").trim();
    const q_en = idxQEn >= 0 ? get(idxQEn) : undefined;
    const a_en = idxAEn >= 0 ? get(idxAEn) : undefined;
    if (q) out.push({ q, a, q_en, a_en });
  }
  return out;
}

async function loadFAQ(): Promise<Array<FaqItem>> {
  if (faqCache) return faqCache;
  try {
    const filePath = path.join(process.cwd(), "genelsorular.csv");
    const buf = fs.readFileSync(filePath, "utf8");
    const out: FaqItem[] = parseCsvFlexible(buf);
    faqCache = out;
    // Also attempt to fetch from Google Sheets and merge
    try {
      const sheetUrlRaw = process.env.FAQ_SHEET_URL?.trim() || DEFAULT_FAQ_SHEET_URL;
      const sheetUrl = sheetUrlRaw.includes("/export?") ? sheetUrlRaw : (sheetUrlRaw.includes("docs.google.com/spreadsheets")
        ? sheetUrlRaw.replace(/\/edit.*$/, "/export?format=csv&gid=0")
        : sheetUrlRaw);
      const resp = await fetch(sheetUrl, { cache: "no-store" });
      if (resp.ok) {
        const csv = await resp.text();
        const add = parseCsvFlexible(csv);
        for (const it of add) {
          if (!out.some(x => normalizeText(x.q, 'tr') === normalizeText(it.q, 'tr'))) {
            out.push(it);
          }
        }
        faqCache = out;
      }
    } catch {}
    return faqCache ?? out;
  } catch {
    // Try remote sheet even if local file missing
    try {
      const sheetUrl = process.env.FAQ_SHEET_URL?.trim() || DEFAULT_FAQ_SHEET_URL;
      const resp = await fetch(sheetUrl, { cache: "no-store" });
      if (!resp.ok) return [];
      const csv = await resp.text();
      const out: FaqItem[] = parseCsvFlexible(csv);
      faqCache = out;
      return out;
    } catch { return []; }
  }
}
function similarity(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  const inter = [...ta].filter(x => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  return inter / union;
}

export async function POST(req: NextRequest) {
  // Read input
  const body = await req.json().catch(() => null);
  const query: string = body?.query ?? "";
  const rawLang = typeof body?.lang === 'string' ? String(body.lang).toLowerCase().trim() : '';
  const lang: "tr" | "en" = rawLang === "en" ? "en" : "tr";
  // Auto-detect Turkish if the user typed in TR while UI language is EN
  const looksTurkish = /[çğıöşü]/i.test(query) || /(uçuş|nerede|ne zaman|var mı|dış hat|iç hat|hangi|gelen|giden)/i.test(query.toLowerCase());
  const effLang: "tr" | "en" = looksTurkish ? "tr" : lang;
  const scope: "domestic" | "international" | undefined =
    body?.scope === "international" ? "international" : body?.scope === "domestic" ? "domestic" : undefined;
  // Resolve absolute base URL for internal API calls (Vercel requires absolute URLs on server)
  const thisOrigin = (process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.trim())
    ? process.env.NEXT_PUBLIC_BASE_URL.trim().replace(/\/$/, "")
    : (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
        : new URL(req.url).origin);

  // Quick response cache hit (keyed by effective language and normalized query)
  const normForKey = normalizeText(query, effLang);
  const quickKey = `${effLang}|${scope || 'all'}|${normForKey}`;
  try { console.log("⚡ query=", query, " key=", quickKey); } catch {}
  const quickHit = quickRespCache.get(quickKey);
  if (normForKey.length >= 3 && quickHit && (Date.now() - quickHit.at) < QUICK_RESP_TTL_MS) {
    return Response.json(quickHit.data);
  }

  // Fast-path: direct flight number like TK2701
  const flightNumQuick = query.match(/\b([A-Za-z]{2})\s?(\d{2,4})\b/);
  if (flightNumQuick && liveFlightsCache && liveFlightsCache.flights?.length) {
    const num = `${flightNumQuick[1].toUpperCase()} ${flightNumQuick[2]}`;
    const compact = num.replace(/\s+/g, "");
    const hit = liveFlightsCache.flights.find(f => f.flightNumber.replace(/\s+/g, "") === compact);
    if (hit) {
      const t = (()=>{ try { return new Date(hit.scheduledTimeLocal).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-US', {hour:'2-digit', minute:'2-digit'});} catch { return hit.scheduledTimeLocal||''; }})();
      const answer = lang === 'tr'
        ? `${hit.flightNumber} ${hit.direction === 'Arrival' ? hit.originCity : hit.destinationCity} ${t}${hit.direction==='Departure' && hit.gate ? `, Kapı ${hit.gate}`:''} — ${hit.status}`
        : `${hit.flightNumber} ${hit.direction === 'Arrival' ? hit.originCity : hit.destinationCity} ${t}${hit.direction==='Departure' && hit.gate ? `, Gate ${hit.gate}`:''} — ${hit.status}`;
      const data = { answer, matches: [hit], nluProvider: 'flights' };
      if (normForKey.length >= 3) quickRespCache.set(quickKey, { at: Date.now(), data });
      return Response.json(data);
    }
  }

  // 1) Try NLU providers concurrently: Groq || Rules (pick first available)
  let nluProvider: "groq" | "rules" | undefined;
  const [groqRes, rulesRes] = await Promise.allSettled([
    extractQueryWithGroq(query),
    Promise.resolve(extractQueryWithRules(query))
  ]);
  let nlu = groqRes.status === 'fulfilled' ? groqRes.value : undefined;
  if (nlu) nluProvider = 'groq';
  if (!nlu) {
    const rules = rulesRes.status === 'fulfilled' ? rulesRes.value : undefined;
    if (rules && (rules.city || rules.type || rules.flightNumber)) {
      nlu = rules; nluProvider = 'rules';
    }
  }

  const city = nlu?.city;
  const type = nlu?.type;
  const flightNumber = nlu?.flightNumber;

  // 2) Fallback: naive regex
  const strip = (s: string) => s
    .toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ").trim();
  const normalized = strip(query);
  const isArrival = /(gelen|varis|varacak|arrival|arrive|arriving)/.test(normalized);
  const isDeparture = /(giden|kalkis|kalkacak|departure|depart)/.test(normalized);
  // Accept TK2695, TK 2695, tk2695 etc.
  const flightNumMatch = normalized.match(/\b([a-z]{2})\s?(\d{2,4})\b/i);
  // Uçuş niyeti anahtar kelimeleri (Türkçe ve İngilizce)
  const hasFlightKeywords = /(\bu[cç]u[sş]\w*|\bsefer\w*|\bgate\b|\bkap[iı]\w*|\bkalk[iı]s\w*|\bvar[iı]s\w*|\bgiden\b|\bgelen\b|\bterminal\b|\bflt\b|\bflight\b)/.test(normalized);
  // Şehir çıkarımı: uçuş niyeti varsa, stopword olmayan son token'ı şehir adayı olarak al
  const stopEarly = new Set(["ne","zaman","when","time","flight","ucus","uçuş","to","from","is","the","today","bugun","bugün","yarin","yarın"]);
  const toksEarly = normalized.split(" ").filter(w => w.length >= 3 && !stopEarly.has(w));
  const cityGuess = hasFlightKeywords ? toksEarly.at(-1) : undefined;

  const allowNluFlight = hasFlightKeywords || !!flightNumMatch;
  const merged = {
    city: city ?? cityGuess,
    type: (isArrival ? "Arrival" : isDeparture ? "Departure" : undefined) ?? (allowNluFlight ? type : undefined),
    flightNumber: flightNumber ?? (flightNumMatch ? `${flightNumMatch[1].toUpperCase()} ${flightNumMatch[2]}` : undefined),
  };
  // Default: if uçuş niyeti var ama yön belirtilmemişse IST bağlamında gidiş (Departure) varsay
  const wantDirDefault: FlightDirection | undefined = merged.type ?? (allowNluFlight ? "Departure" : undefined);

  // Helper: naive HTML -> text
  function decodeEntities(s: string) {
    try {
      // hex entities
      s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      // dec entities
      s = s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
      // common named
      s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      return s;
    } catch { return s; }
  }

  function htmlToText(html: string) {
    try {
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        // remove header/nav/footer like mega menus
        .replace(/İGA\s+İstanbul[\s\S]*?(TR\s*EN|English\s*\/\s*EN)/gi, " ")
        .replace(/(Kalkış|Varış)\s+Daha Fazlasını Göster[\s\S]*?\s/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return decodeEntities(cleaned);
    } catch { return html; }
  }

  // If no clear flight intent, route ALL general questions to Groq
  // Guard: typical general topics signal (not mandatory, just heuristic)
  const generalGuard = /(bagaj|bavul|otopark|havaist|taksi|otob[uü]s|wifi|wi\-?fi|loung[e]?|harita|rehber|sss|sıkça|adres|konum|nerede|duty\s?free|ma[gğ]aza|yeme|i[cç]e|restoran)/i.test(query);
  const looksLikeFlight = /\b[a-z]{2}\s?\d{2,4}\b/i.test(normalized) || hasFlightKeywords;
  // Eğer genel konulara (duty free, lounge, otopark vb.) işaret eden ifadeler varsa,
  // uçuş anahtar kelimeleri geçse bile önce Groq'a yönlendir.
  if (generalGuard) {
    try {
      const faq = await loadFAQ().catch(() => [] as FaqItem[]);
      const nq = normalizeText(query, lang);
      const scoredFaq = (faq || [])
        .map((x, i) => ({ i, s: similarity(nq, normalizeText(lang === 'en' ? (x.q_en || x.q) : x.q, lang)) }))
        .sort((a,b)=> b.s - a.s);
      const coreFacts = scoredFaq.slice(0, 8)
        .map(({ i }, k) => `[${k+1}] ${faq[i].q}\n${faq[i].a}`)
        .join("\n\n");
      const context = `\nİstanbul Havalimanı (IST), Türkiye’nin en büyük uluslararası havalimanıdır.\nHem iç hat hem de dış hat uçuşları bulunur.\nTerminal 1 genellikle dış hatlar, iç hatlar terminali ise yurt içi seferler için kullanılır.\nHavalimanında restoranlar, mağazalar, ibadet alanları (mescit), çocuk oyun alanları, lounge hizmetleri, otopark, taksi, Havaist otobüsleri ve duty free mağazaları mevcuttur.\n`;
      const facts = `${context}\n\n${coreFacts}`;
      try { console.log("🧠 Groq facts length:", facts.length); } catch {}
      const groqAnswer = await groqChatSmart({ question: query, facts, language: effLang });
      try { console.log("🧠 Groq output:", groqAnswer ? groqAnswer.slice(0, 120) : ""); } catch {}
      if (groqAnswer) {
        return Response.json({ answer: groqAnswer, matches: [], nluProvider: "groq" });
      }
    } catch (e) {
      try { console.error("🔹 Groq general error:", e); } catch {}
    }
    // Groq cevap üretemezse, mevcut akışa devam (gerekirse uçuş filtresi dener)
  }
  if (!looksLikeFlight) {
    try {
      const faq = await loadFAQ().catch(() => [] as FaqItem[]);
      const nq = normalizeText(query, lang);
      const scoredFaq = (faq || [])
        .map((x, i) => ({ i, s: similarity(nq, normalizeText(lang === 'en' ? (x.q_en || x.q) : x.q, lang)) }))
        .sort((a,b)=> b.s - a.s);
      // CSV + Sheet verilerinden en alakalı 8 soru + genel İstanbul Havalimanı bilgisi birleştirilir
      const coreFacts = scoredFaq.slice(0, 8)
        .map(({ i }, k) => `[${k+1}] ${faq[i].q}\n${faq[i].a}`)
        .join("\n\n");
      const context = `\nİstanbul Havalimanı (IST), Türkiye’nin en büyük uluslararası havalimanıdır.\nHem iç hat hem de dış hat uçuşları bulunur.\nTerminal 1 genellikle dış hatlar, iç hatlar terminali ise yurt içi seferler için kullanılır.\nHavalimanında restoranlar, mağazalar, ibadet alanları (mescit), çocuk oyun alanları, lounge hizmetleri, otopark, taksi, Havaist otobüsleri ve duty free mağazaları mevcuttur.\n`;
      const facts = `${context}\n\n${coreFacts}`;
      try { console.log("🧠 Groq facts length:", facts.length); } catch {}
      const groqAnswer = await groqChatSmart({ question: query, facts, language: effLang });
      try { console.log("🧠 Groq output:", groqAnswer ? groqAnswer.slice(0, 120) : ""); } catch {}
      if (groqAnswer) {
        return Response.json({ answer: groqAnswer, matches: [], nluProvider: "groq" });
      }
    } catch (e) {
      try { console.error("🔹 Groq path error:", e); } catch {}
    }
    return Response.json({
      answer: effLang === 'tr' ? 'Bu konuda kesin bilgi bulamadım. Lütfen farklı ifade edin.' : "I couldn't find this information. Please rephrase your question.",
      matches: [],
      nluProvider: 'groq-fallback'
    });
  }

  // Live flights helper (restored)
  async function loadLiveFlights(forceAllScopes: boolean = false, allowCache: boolean = true, overrideScope?: "domestic" | "international"): Promise<Flight[]> {
    const directions: Array<{ nature: string; direction: FlightDirection }> = [
      { nature: "1", direction: "Departure" },
      { nature: "0", direction: "Arrival" },
    ];
    const effScope = overrideScope ?? scope;
    const scopes = forceAllScopes
      ? ["0", "1"]
      : (effScope === "international" ? ["1"] : effScope === "domestic" ? ["0"] : ["0", "1"]);
    // Cache yalnızca tüm kapsamlar (both scopes) istendiğinde kullanılmalı.
    const requestingBothScopes = scopes.length === 2;
    if (allowCache && requestingBothScopes && liveFlightsCache && (Date.now() - liveFlightsCache.at) < FLIGHT_CACHE_TTL_MS) {
      return liveFlightsCache.flights;
    }
    const tasks = directions.flatMap((d) =>
      scopes.map((isInternational) => {
        const body = new URLSearchParams({
          nature: d.nature,
          searchTerm: "",
          pageSize: "100",
          isInternational,
          date: "",
          endDate: "",
          culture: lang === "tr" ? "tr" : "en",
        }).toString();
        return fetch(`${thisOrigin}/api/istairport/status`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          cache: "no-store",
          body,
        })
          .then((r) => r.json().catch(() => ({})))
          .then((json) => {
            const flights: any[] = json?.data?.result?.data?.flights || [];
            return flights.map((f) => ({
              id: `${f.flightNumber}-${d.direction}`,
              airportCode: "IST",
              flightNumber: f.flightNumber,
              airline: f.airlineName,
              direction: d.direction,
              originCity: f.fromCityName,
              destinationCity: f.toCityName,
              scheduledTimeLocal: f.scheduledDatetime,
              estimatedTimeLocal: f.estimatedDatetime,
              status: f.remark,
              gate: f.gate,
              baggage: f.carousel,
            })) as Flight[];
          })
          .catch(() => [] as Flight[]);
      })
    );

    try { console.log("🛰️ loadLiveFlights scopes=", scopes.join(",")); } catch {}
    const settled = await Promise.allSettled(tasks);
    const uniqueFlights = Array.from(
      new Map(
        settled
          .filter((r): r is PromiseFulfilledResult<Flight[]> => r.status === "fulfilled")
          .flatMap((r) => r.value)
          .map((f) => [`${f.flightNumber}-${f.scheduledTimeLocal}-${f.direction}`, f] as const)
      ).values()
    );
    try { console.log("🛰️ loadLiveFlights fetched=", uniqueFlights.length); } catch {}
    // Fallback: IST API bazen isInternational="1" için boş döner. Bu durumda her iki kapsamı da çek.
    if (uniqueFlights.length === 0 && effScope === "international") {
      try { console.warn("⚠️ International flight data empty — falling back to all scopes..."); } catch {}
      return await loadLiveFlights(true, false);
    }

    if (allowCache && requestingBothScopes) {
      liveFlightsCache = { at: Date.now(), flights: uniqueFlights };
      setTimeout(() => { loadLiveFlights(true, false).catch(() => {}); }, Math.max(1_000, FLIGHT_CACHE_TTL_MS - 60_000));
    }
    return uniqueFlights;
  }

  // Parallelize DB + Live and prefer whichever arrives with data
  // Basit sorgu niyeti: 'dış hat', 'international', 'yurtdışı' vurgusu varsa scope'u international'a zorla
  const wantsIntlByQuery = /(dış\s*hat|dis\s*hat|international|yurt\s*d[ıi]şı|yurtdışı|abroad)/i.test(query);
  const effectiveScope: "domestic" | "international" | undefined = wantsIntlByQuery ? "international" : scope;
  try { console.log("🛰️ request scope=", scope, "effective=", effectiveScope); } catch {}

  const [dbRes, liveRes] = await Promise.allSettled([
    fetchFlightsFromDbCached(),
    // Assistant aramasında her iki kapsamı da çek (cache mevcutsa hızlı döner)
    loadLiveFlights(true, true)
  ]);
  const dbFlights = dbRes.status === 'fulfilled' ? dbRes.value : [];
  const liveFlights = liveRes.status === 'fulfilled' ? liveRes.value : [];
  let allFlights: Flight[] = liveFlights.length ? liveFlights : (dbFlights.length ? dbFlights : staticFlights);

  // Fuzzy filter: score on flightNumber, city (origin/dest), airline
  const qFlight = (merged.flightNumber || "").toUpperCase();
  let qCity = merged.city ? strip(merged.city) : "";
  const wantDir = merged.type as FlightDirection | undefined;
  // Infer direction from natural language if not explicitly provided
  let inferredDir: FlightDirection | undefined = undefined;
  try {
    const ql = query.toLowerCase();
    if (/(\bto\b|gidiş|gidis|kalkış|kalkis|kalkan|giden|depart|departure)/i.test(ql)) inferredDir = "Departure";
    if (/(\bfrom\b|gelen|varış|varis|iniş|inis|arrive|arrival)/i.test(ql)) inferredDir = "Arrival";
  } catch {}
  const preferDir: FlightDirection | undefined = wantDir ?? inferredDir;
  // Build tokens from query to match multi-word cities (e.g., "kocaseyit edremit")
  const stopWords = new Set([
    // TR
    "ucus","ucusu","uclus","ucuslar","uçuş","uçuşu","uçuşlar","ne","zaman","kalkis","kalkış","varis","varış","gelen","giden","gate","kapi","kapı","hangi","mi","mı","mu","mü","saat","saatte","kac","kaç","nerede","var","mi?",
    // EN
    "is","when","what","which","where","time","flight","flights","to","from","the","a","an","at","in","on","of","for","do","does","are","am","pm","today","tomorrow"
  ]);
  const tokens = normalized.split(" ")
    .filter(w => w.length >= 3 && !stopWords.has(w));
  // Infer city from IATA codes (common international destinations)
  const iataToCity: Record<string, string> = {
    "lhr":"london","lgw":"london","stn":"london","ltn":"london",
    "cdg":"paris","ory":"paris",
    "jfk":"newyork","ewr":"newyork","lga":"newyork",
    "bos":"boston","mia":"miami","sea":"seattle","ord":"chicago","iad":"washington","dca":"washington",
    "nrt":"tokyo","hnd":"tokyo",
    "ams":"amsterdam","fra":"frankfurt","muc":"munich","fco":"rome","mxp":"milan","bgy":"milan","lin":"milan",
    "zrh":"zurich","gva":"geneva","bcn":"barcelona","lyS":"lyon","vko":"moscow","svo":"moscow","dme":"moscow",
    "rix":"riga","bsl":"basel","mlh":"basel","eap":"basel","tiv":"tivat","lax":"losangeles","sfo":"sanfrancisco"
  };
  if (!qCity) {
    const iata = tokens.find(t => /^[a-z]{3}$/i.test(t));
    if (iata) {
      const mapped = iataToCity[iata.toLowerCase()];
      if (mapped) qCity = mapped;
    }
  }
  // Detect explicit city token in the query (strict)
  const tokenCityMap: Record<string, string> = {
    "moskova": "moscow", "moscow": "moscow", "москва": "moscow",
    "paris": "paris", "parıs": "paris",
    "london": "london", "londra": "london",
    "boston": "boston", "miami": "miami", "chicago": "chicago", "seattle": "seattle",
    "tokyo": "tokyo", "zurich": "zurich", "zürih": "zurich", "geneva":"geneva",
  };
  const detectedCityFromTokens = (() => {
    for (const t of tokens) {
      const m = tokenCityMap[t];
      if (m) return m;
    }
    return "";
  })();
  // City aliases map
  const aliasMap: Record<string, string> = {
    "londra":"london","paris":"paris","parıs":"paris","new york":"newyork","newyork":"newyork",
    "boston":"boston","miami":"miami","seattle":"seattle","chicago":"chicago","washington":"washington",
    "tokyo":"tokyo","moskova":"moscow","moscow":"moscow","zurich":"zurich","zürih":"zurich","geneva":"geneva",
    "barselona":"barcelona","barcelona":"barcelona","frankfurt":"frankfurt","munich":"munich","münih":"munich",
    "roma":"rome","rome":"rome","milan":"milan","milano":"milan","lyon":"lyon","riga":"riga","basel":"basel","tivat":"tivat"
  };
  if (qCity && aliasMap[qCity]) qCity = aliasMap[qCity];
  const domesticCityList = [
    "istanbul","ankara","izmir","antalya","adana","bursa","gaziantep","kayseri","trabzon","diyarbakir","eskisehir","samsun","van","konya","mersin","kocaeli","izmit","bodrum","mugla","dalaman","ankara esenboga","esenboga","sabiha gokcen","sabiha","hatay","erzurum","erzincan","sivas","malatya","elazig","sanliurfa","urfa","mardin","batman","mus","siirt","kastamonu","sinop","bolu","zonguldak","rize","artvin","ordu","giresun","aydin","tekirdag","edirne","kars","igdir","agri","kütahya","kutahya","balikesir","canakkale","çanakkale","sakarya","duzce","yozgat","kirikkale","kirklareli","kirsehir","nevsehir","aksaray","nigde","afyon","manisa","denizli","isparta","burdur","osmaniye","karaman","bilecik","bingol","bitlis","hakkari"
  ];
  const domesticCities = new Set(domesticCityList.map(strip));
  function score(f: Flight): number {
    let s = 0;
    if (preferDir && f.direction === preferDir) s += 3;
    if (qFlight) {
      const fn = f.flightNumber.toUpperCase();
      if (fn === qFlight || fn.replace(/\s+/g, "") === qFlight.replace(/\s+/g, "")) s += 6;
      else if (fn.includes(qFlight)) s += 3;
    }
    if (qCity) {
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      // şehir eşleşmesini daha katı yapalım
      if (oc === qCity || dc === qCity) s += 5;
      else if (oc.startsWith(qCity) || dc.startsWith(qCity)) s += 3;
      else if (oc.includes(qCity) || dc.includes(qCity)) s += 1;
    }
    // Token-based fuzzy for multi-word/compound names (always apply)
    if (tokens.length) {
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      let hit = 0;
      for (const t of tokens) {
        if (oc.includes(t) || dc.includes(t)) hit++;
      }
      if (hit >= 2) s += 5; // both parts matched (e.g., kocaseyit + edremit)
      else if (hit === 1) s += 2;
    }
    // slight boost for near-time flights (within +/- 6h)
    try {
      const t = new Date(f.scheduledTimeLocal).getTime();
      const now = Date.now();
      const diffH = Math.abs(t - now) / 3600000;
      s += diffH < 2 ? 2 : diffH < 6 ? 1 : 0;
    } catch {}
    // If user wanted international (effectiveScope), prefer non-domestic other city
    try {
      if (effectiveScope === 'international') {
        const oc = strip(f.originCity);
        const dc = strip(f.destinationCity);
        const isIstanbul = (w: string) => w.includes('istanbul');
        const other = f.direction === 'Departure' ? dc : oc;
        const otherNorm = strip(other);
        if (domesticCities.has(otherNorm)) s -= 3; else s += 2;
      }
    } catch {}
    return s;
  }
  const scored = allFlights.map(f => ({ f, s: score(f) }));
  const top = scored.filter(x => x.s > 0).sort((a,b) => b.s - a.s).slice(0, 20).map(x => x.f);
  const prelim = top.length ? top : filterFlights(allFlights, { type: preferDir, city: merged.city, flightNumber: merged.flightNumber });
  // Prefer chosen direction first
  const dirFiltered = preferDir ? prelim.filter(f => f.direction === preferDir) : prelim;
  // Prefer earliest upcoming flight(s) by time (>= now - 5m), then fallback to time asc
  const nowTs = Date.now();
  const future = dirFiltered.filter(f => {
    try { return new Date(f.scheduledTimeLocal).getTime() >= nowTs - 5*60*1000; } catch { return true; }
  }).sort((a,b) => {
    try { return new Date(a.scheduledTimeLocal).getTime() - new Date(b.scheduledTimeLocal).getTime(); } catch { return 0; }
  });
  // If there is no upcoming flight, consider most recent past flight within last 6 hours
  let result: Flight[];
  if (future.length) {
    result = future.slice(0, 50);
  } else {
    const recentPast = dirFiltered
      .map(f => ({ f, t: (()=>{ try { return new Date(f.scheduledTimeLocal).getTime(); } catch { return 0; } })() }))
      .filter(x => x.t && x.t >= nowTs - 6*60*60*1000 && x.t < nowTs)
      .sort((a,b) => b.t - a.t)
      .map(x => x.f)
      .slice(0, 5);
    result = recentPast.length ? recentPast : dirFiltered.slice(0, 50);
  }

  // STRICT CITY/TOKEN FILTER: keep only flights that actually match the asked city/tokens
  if (qCity || tokens.length) {
    const filtered = result.filter(f => {
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      const other = f.direction === 'Departure' ? dc : oc;
      const otherNorm = strip(other);
      const cityHit = qCity ? (otherNorm === qCity || otherNorm.startsWith(qCity) || otherNorm.includes(qCity)) : false;
      const tokenCount = tokens.reduce((acc,t)=> acc + (otherNorm.includes(t) ? 1 : 0), 0);
      // If we confidently detected a city from tokens (e.g., 'moskova'), require it strictly
      if (!qCity && detectedCityFromTokens) return otherNorm.includes(detectedCityFromTokens);
      if (qCity && tokens.length >= 2) return cityHit || tokenCount >= 2;
      if (qCity) return cityHit;
      if (tokens.length >= 2) return tokenCount >= 2; // multi-word names need stronger match
      return tokenCount >= 1;
    });
    if (filtered.length) result = filtered;
  }

  // If user intent indicates international, try to keep only non-domestic counterparts
  if (effectiveScope === 'international' && result.length) {
    const intlOnly = result.filter((f) => {
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      const other = f.direction === 'Departure' ? dc : oc;
      return !domesticCities.has(strip(other));
    });
    if (intlOnly.length) {
      result = intlOnly;
    }
  }

  // Final fallback: if still empty, relax direction and rely solely on token hits
  if (result.length === 0 && tokens.length) {
    const rescored = allFlights.map(f => {
      let s = 0;
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      let hit = 0;
      for (const t of tokens) {
        if (oc.includes(t) || dc.includes(t)) hit++;
      }
      if (hit >= 2) s += 5; // both parts matched (e.g., kocaseyit + edremit)
      else if (hit === 1) s += 2;
      // prefer future
      try {
        const t = new Date(f.scheduledTimeLocal).getTime();
        const now = Date.now();
        if (t >= now - 5*60*1000) s += 2;
      } catch {}
      return { f, s };
    });
    result = rescored.filter(x => x.s > 0).sort((a,b)=> b.s - a.s).map(x=>x.f).slice(0, 10);
  }

  // If a city was provided but no matches remain, do NOT dump all flights; ask user to refine city.
  if (result.length === 0 && (qCity || tokens.length)) {
    return Response.json({
      answer: lang === "tr" ? "Eşleşen uçuş bulunamadı. Lütfen şehir adını doğru yazarak tekrar deneyin (örn. 'Paris', 'London', 'Boston')." : "No matching flights found. Please check the city name and try again (e.g., 'Paris', 'London', 'Boston').",
      matches: [],
      nluProvider: 'flights',
    });
  }

  if (result.length === 0) {
    return Response.json({
      answer: lang === "tr" ? "Uçuş bulunamadı. Lütfen uçuş numarası veya şehir adını netleştirerek tekrar dener misiniz?" : "No matching flights found. Please try again with a flight number or clearer city name.",
      matches: [],
      nluProvider: 'flights',
    });
  }

  const fmtTime = (s?: string) => {
    if (!s) return "";
    try { const d = new Date(s); return d.toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" }); } catch { return s; }
  };
  const lines = result.map((f) => {
    const cityText = f.direction === "Arrival" ? f.originCity : f.destinationCity;
    const gateOrBaggage = f.direction === "Departure" ? (f.gate ? `Gate ${f.gate}` : "") : (f.baggage ? `${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}` : "");
    const timePair = `${fmtTime(f.scheduledTimeLocal)}${f.estimatedTimeLocal ? ` / ${fmtTime(f.estimatedTimeLocal)}` : ""}`;
    return `${f.flightNumber} ${cityText} ${timePair}${gateOrBaggage ? `, ${gateOrBaggage}` : ""} — ${f.status}`;
  });
  // Varsayılan davranış: eğer birden fazla eşleşme varsa ve kullanıcı belirli bir uçuş numarası sormadıysa listele
  const wantsListExplicit = /listele|list/gi.test(query);
  const wantsListAuto = !qFlight && result.length > 1;
  const wantsList = wantsListExplicit || wantsListAuto;
  const bestLine = lines[0];
  let answer = wantsList
    ? (lang === "tr"
        ? `Eşleşen uçuşlar:\n${lines.join("\n")}\nİsterseniz uçuş numarasıyla sorabilirsiniz.`
        : `Matching flights:\n${lines.join("\n")}\nYou can ask by flight number for a specific one.`)
    : (lang === "tr" ? `Uçuş: ${bestLine}` : `Flight: ${bestLine}`);

  // Keep plain flight phrasing without Azure/OpenAI refinement

  const finalData = { answer, matches: result, nluProvider: 'flights' };
  // Store quick cache for repeated queries
  try { if (normForKey.length >= 3) quickRespCache.set(quickKey, { at: Date.now(), data: finalData }); } catch {}
  return Response.json(finalData);
}