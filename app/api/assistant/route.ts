import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import type { Flight, FlightDirection } from "@/lib/types";
import { extractQueryWithGroq } from "@/lib/ai/groq";
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
  const body = await req.json().catch(() => null);
  const query: string = body?.query ?? "";
  const lang: "tr" | "en" = body?.lang === "en" ? "en" : "tr";
  const scope: "domestic" | "international" | undefined =
    body?.scope === "international" ? "international" : body?.scope === "domestic" ? "domestic" : undefined;
  const wantDebug: boolean = !!body?.debug;
  // Resolve absolute base URL for internal API calls (Vercel requires absolute URLs on server)
  const thisOrigin = (process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.trim())
    ? process.env.NEXT_PUBLIC_BASE_URL.trim().replace(/\/$/, "")
    : (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
        : new URL(req.url).origin);

  // Quick response cache hit
  const quickKey = `${lang}|${query.trim().toLowerCase()}`;
  const quickHit = quickRespCache.get(quickKey);
  if (quickHit && (Date.now() - quickHit.at) < QUICK_RESP_TTL_MS) {
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
      const data = { answer, matches: [hit], nluProvider: 'fastpath' };
      quickRespCache.set(quickKey, { at: Date.now(), data });
      return Response.json(data);
    }
  }

  // Early: try FAQ direct answer to avoid mixing with flight/RAG logic
  // BUT: if query clearly asks about flights, skip FAQ and continue to flight branch
  const looksFlightEarly = /(uçuş|ucus|flight|gate|kalkış|kalkis|varış|varis|arrival|arrive|arriving|departure|depart)/i.test(query);
  if (!looksFlightEarly) try {
    const faq = await loadFAQ();
    if (faq.length) {
      const nq = normalizeText(query, lang);
      // If specific intents exist, restrict candidate FAQs accordingly
      const needWifiKiosk = /\bwifi\b/.test(nq) && /\bkiosk\b/.test(nq);
      const isLocationIntent = /(nerede|konum|noktalar|lokasyon|where|location|points)/i.test(query);
      const needFastTrackLocation = /\bfasttrack\b/.test(nq) && isLocationIntent;
      const needParkingSubscription = /\bparking\b/.test(nq) && /\bsubscription\b/.test(nq);
      const cand = needWifiKiosk
        ? faq.filter(x => { const qq = (lang === 'en' ? (x.q_en || x.q) : x.q); const qn = normalizeText(qq, lang); return /\bwifi\b/.test(qn) && /\bkiosk\b/.test(qn); })
        : needFastTrackLocation
          ? faq.filter(x => { const qq = (lang === 'en' ? (x.q_en || x.q) : x.q); const qn = normalizeText(qq, lang); return /\bfasttrack\b/.test(qn) && /(nerede|konum|noktalar|lokasyon|where|location|points)/.test(qq.toLowerCase()); })
          : needParkingSubscription
            ? faq.filter(x => { const qq = (lang === 'en' ? (x.q_en || x.q) : x.q); const qn = normalizeText(qq, lang); return /\bparking\b/.test(qn) && /\bsubscription\b/.test(qn); })
            : faq;
      // Deterministic FastTrack location answer to avoid wrong matches
      if (needFastTrackLocation) {
        const ftItem = faq.find(x => {
          const qnTr = normalizeText(x.q, 'tr');
          return /\bfasttrack\b/.test(qnTr) && /(nerede|noktalar|lokasyon)/.test(x.q.toLowerCase());
        }) || cand[0];
        if (ftItem) {
          const ansRaw = (lang === 'en' ? (ftItem.a_en || '') : ftItem.a).trim();
          if (ansRaw) {
            return Response.json({ answer: ansRaw, matches: [], nluProvider: 'faq-csv', faq: { score: 1, q: (lang==='en' ? (ftItem.q_en || ftItem.q) : ftItem.q) } });
          }
          if (lang === 'en' && (ftItem.a || '').trim()) {
            const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
            const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
            if (OPENAI_API_KEY_FAQ) {
              try {
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${OPENAI_API_KEY_FAQ}`, 'Content-Type': 'application/json', ...(OPENAI_PROJECT_ID_FAQ ? { 'OpenAI-Project': OPENAI_PROJECT_ID_FAQ } : {}) },
                  body: JSON.stringify({ model: 'gpt-4o-mini', messages: [ { role: 'system', content: 'Translate the following Turkish answer into clear, concise English. Do not add extra information.' }, { role: 'user', content: ftItem.a } ], temperature: 0.1 })
                });
                if (resp.ok) {
                  const j = await resp.json().catch(()=>null);
                  const content = j?.choices?.[0]?.message?.content?.trim();
                  if (content) return Response.json({ answer: content, matches: [], nluProvider: 'faq-translate', faq: { score: 1, q: (ftItem.q_en || ftItem.q) } });
                }
              } catch {}
            }
          }
          return Response.json({ answer: lang === 'tr' ? 'Bu konuda kesin bir bilgi bulamadım. Lütfen farklı ifade ile tekrar sorar mısınız?' : "Couldn't find definitive info. Please rephrase your question.", matches: [], nluProvider: 'faq-empty' });
        }
      }
      // 1) Exact/substring normalized match shortcut
      const candsNorm = cand.map((x, i) => ({ i, item: x, qn: normalizeText(lang === 'en' ? (x.q_en || x.q) : x.q, lang) }));
      const exact = candsNorm.find(c => c.qn === nq);
      const contains = !exact ? candsNorm.find(c => (c.qn.length > 6 && (c.qn.includes(nq) || nq.includes(c.qn)))) : undefined;
      const direct = exact || contains;
      if (direct) {
        const item = direct.item;
        const ansRaw = (lang === 'en' ? (item.a_en || '') : item.a).trim();
        if (ansRaw) {
          return Response.json({ answer: ansRaw, matches: [], nluProvider: 'faq-csv', faq: { score: 1, q: (lang==='en' ? (item.q_en || item.q) : item.q) } });
        }
        if (lang === 'en' && (item.a || '').trim()) {
          const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
          const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
          if (OPENAI_API_KEY_FAQ) {
            try {
              const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY_FAQ}`, 'Content-Type': 'application/json', ...(OPENAI_PROJECT_ID_FAQ ? { 'OpenAI-Project': OPENAI_PROJECT_ID_FAQ } : {}) },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages: [ { role: 'system', content: 'Translate the following Turkish answer into clear, concise English. Do not add extra information.' }, { role: 'user', content: item.a } ], temperature: 0.1 })
              });
              if (resp.ok) {
                const j = await resp.json().catch(()=>null);
                const content = j?.choices?.[0]?.message?.content?.trim();
                if (content) return Response.json({ answer: content, matches: [], nluProvider: 'faq-translate', faq: { score: 1, q: (item.q_en || item.q) } });
              }
            } catch {}
          }
        }
        return Response.json({ answer: lang === 'tr' ? 'Bu konuda kesin bir bilgi bulamadım. Lütfen farklı ifade ile tekrar sorar mısınız?' : "Couldn't find definitive info. Please rephrase your question.", matches: [], nluProvider: 'faq-empty' });
      }

      // 2) Similarity scoring fallback
      let scored = cand.map((x, i) => {
        const qtext = lang === 'en' ? (x.q_en || x.q) : x.q;
        const base = similarity(nq, normalizeText(qtext, lang));
        // small boost if location intent words appear in candidate question
        const locBoost = isLocationIntent && /(nerede|konum|noktalar|lokasyon|where|location|points)/.test((qtext||"").toLowerCase()) ? 0.08 : 0;
        const ftBoost = /\bfasttrack\b/.test(nq) && /\bfast\s*track\b|\bfasttrack\b/.test((qtext||"").toLowerCase()) ? 0.06 : 0;
        return { i, s: base + locBoost + ftBoost };
      }).sort((a,b)=> b.s - a.s);
      let bestIdx = scored.length ? scored[0].i : -1;
      let best = scored.length ? scored[0].s : 0;
      // If English and low score, translate query to Turkish to match TR questions
      if (lang === 'en' && (best < 0.20)) {
        const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
        const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
        if (OPENAI_API_KEY_FAQ) {
          try {
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`,
                "Content-Type": "application/json",
                ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}),
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "Translate the user's question into Turkish only. Return just the translation text." },
                  { role: "user", content: query }
                ],
                temperature: 0.0,
              }),
            });
            if (resp.ok) {
              const j = await resp.json().catch(()=>null);
              const trQ = j?.choices?.[0]?.message?.content?.trim();
              if (trQ) {
                const nqTr = normalizeText(trQ, 'tr');
                scored = cand.map((x, i) => ({ i, s: similarity(nqTr, normalizeText(x.q, 'tr')) }))
                  .sort((a,b)=> b.s - a.s);
                bestIdx = scored.length ? scored[0].i : -1;
                best = scored.length ? scored[0].s : 0;
              }
            }
          } catch {}
        }
      }
      if (bestIdx >= 0 && best >= 0.20) {
        const base = needWifiKiosk ? cand : faq;
        const item = base[bestIdx];
        const ansRaw = (lang === 'en' ? (item.a_en || '') : item.a).trim();
        if (ansRaw) {
          return Response.json({ answer: ansRaw, matches: [], nluProvider: "faq-csv", faq: { score: best, q: (lang==='en' ? (item.q_en || item.q) : item.q) } });
        }
        // If English requested but only Turkish answer exists, translate it
        if (lang === 'en' && (item.a || '').trim()) {
          const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
          const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
          if (OPENAI_API_KEY_FAQ) {
            try {
              const system = "Translate the following Turkish answer into clear, concise English. Do not add extra information.";
              const userMsg = item.a;
              const resp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`,
                  "Content-Type": "application/json",
                  ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}),
                },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ], temperature: 0.1 }),
              });
              if (resp.ok) {
                const j = await resp.json().catch(()=>null);
                const content = j?.choices?.[0]?.message?.content?.trim();
                if (content) return Response.json({ answer: content, matches: [], nluProvider: "faq-translate", faq: { score: best, q: (item.q_en || item.q) } });
              }
            } catch {}
          }
        }
        // Answer is empty in CSV/Sheet: ask OpenAI to produce a concise answer
        const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
        const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
        if (OPENAI_API_KEY_FAQ) {
          try {
            const system = lang === "tr"
              ? "İstanbul Havalimanı genel danışma asistanısın. Kullanıcının sorusuna kısa, net ve doğru bir cevap ver. Uydurma bilgi verme. Bilgin yoksa kibarca belirt ve ilgili sayfayı öner."
              : "You are an Istanbul Airport assistant. Provide a short, accurate answer. If unsure, say so politely and suggest the relevant page.";
            const userMsg = query;
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`,
                "Content-Type": "application/json",
                ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}),
              },
              body: JSON.stringify({ model: "gpt-4o-mini", messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ], temperature: 0.1, max_tokens: 120 }),
            });
            if (resp.ok) {
              const j = await resp.json().catch(()=>null);
              const content = j?.choices?.[0]?.message?.content?.trim();
              if (content) return Response.json({ answer: content, matches: [], nluProvider: "faq-openai-empty", faq: { score: best, q: (lang==='en' ? (item.q_en || item.q) : item.q) } });
            }
          } catch {}
        }
        // last resort
      }
    }
  } catch {}

  // 0-b) If forced, route ALL questions directly to OpenAI and return
  const OPENAI_ONLY = String(process.env.OPENAI_ONLY || "").toLowerCase() === "true";
  const OPENAI_API_KEY_DIRECT = process.env.OPENAI_API_KEY?.trim();
  const OPENAI_PROJECT_ID_DIRECT = process.env.OPENAI_PROJECT_ID?.trim();
  if (OPENAI_ONLY && OPENAI_API_KEY_DIRECT) {
    try {
      // Gather flight candidates from live data to give OpenAI concrete facts
      const stripLite = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim();
      const trBase = (w: string) => w
        // common Turkish case/postposition endings
        .replace(/^(?:istanbul\s+)?havalimani$/,'ist')
        .replace(/'(?:de|da|den|dan|e|a|ye|ya)$/,'')
        .replace(/(?:lerde|larda|lerden|lardan|lere|lara|de|da|den|dan|e|a|ye|ya)$/,'')
        .replace(/^(.*?)(?:\s+ucus|\s+uçuş)$/,'$1')
        .replace(/[^a-z0-9]+/g,'')
      ;
      const norm = stripLite(query);
      const stop = new Set([
        "ne","zaman","when","time","flight","ucus","uçuş","ucusu","uçuşu","ucuslar","uçuşlar",
        "to","from","is","the","today","bugun","bugün","yarin","yarın","saat","kacta","kaçta",
        "var","mi","mı","mu","mü","miyim","miyim?","midir","nedir","hangi","ne zaman"
      ]);
      const rawToks = norm.split(" ").filter(w => w.length >= 3 && !stop.has(w));
      const toks = rawToks.map(trBase).filter(Boolean);
      const wantArr = /(arrival|arrive|arriving|gelen|varis|varış)/.test(norm);
      const wantDep = /(departure|depart|giden|kalkis|kalkış)/.test(norm);

      let candidates: Flight[] = await loadLiveFlights(true);
      if (!candidates.length) {
        candidates = (await fetchFlightsFromDb()).length ? await fetchFlightsFromDb() : staticFlights;
      }
      // Build city vocabulary to pick a better cityHint
      const cityVocab = new Set<string>();
      for (const f of candidates) {
        cityVocab.add(trBase(stripLite(f.originCity)));
        cityVocab.add(trBase(stripLite(f.destinationCity)));
      }
      let cityHint = toks.reverse().find(t => cityVocab.has(t));
      if (!cityHint) cityHint = toks.slice(-1)[0];
      // Basic filtering
      if (wantArr || wantDep) candidates = candidates.filter(f => f.direction === (wantArr ? "Arrival" : "Departure"));
      if (cityHint || toks.length) {
        candidates = candidates.filter(f => {
          const oc = trBase(stripLite(f.originCity));
          const dc = trBase(stripLite(f.destinationCity));
          const cc = [oc, dc].join(" ");
          const tokenHits = toks.filter(t => t && cc.includes(t)).length;
          if (cityHint && (oc.includes(cityHint) || dc.includes(cityHint))) return true;
          // relax: at least one meaningful token should match
          return tokenHits >= 1;
        });
      }
      // Sort by upcoming soonest
      candidates = candidates.sort((a,b) => {
        try { return new Date(a.scheduledTimeLocal).getTime() - new Date(b.scheduledTimeLocal).getTime(); } catch { return 0; }
      }).slice(0, 50);

      const fmtTime = (s?: string) => { try { return s ? new Date(s).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", {hour:"2-digit", minute:"2-digit"}) : ""; } catch { return s||""; } };
      const facts = candidates.map((f,i)=>`[${i+1}] ${f.flightNumber} ${(f.direction === "Arrival" ? f.originCity : f.destinationCity)} ${fmtTime(f.scheduledTimeLocal)}${f.estimatedTimeLocal?` / ${fmtTime(f.estimatedTimeLocal)}`:""}${f.direction === "Departure" ? (f.gate?`, Gate ${f.gate}`:"") : (f.baggage?`, ${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}`:"")} — ${f.status}`).join("\n");

      const system = lang === "tr"
        ? "İstanbul Havalimanı için konuşan bir asistansın. UÇUŞ BİLGİLERİ listesini GERÇEK kaynak olarak kullan.\n- Bir eşleşme varsa: tek cümlede saat/kapı/durum ver.\n- Birden fazla eşleşme varsa: tümünü satır satır listele (kısa).\n- Eşleşme yoksa: kibarca belirt ve ilgili sayfayı öner."
        : "You are an assistant for Istanbul Airport. Use FLIGHT FACTS as ground truth. If exactly one match: one concise sentence with time/gate/status. If multiple: list ALL matches line by line (short). If none: say so politely; do not fabricate.";
      const userMsg = facts ? `${query}\n\nFLIGHT FACTS:\n${facts}` : query;

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY_DIRECT}`,
          "Content-Type": "application/json",
          ...(OPENAI_PROJECT_ID_DIRECT ? { "OpenAI-Project": OPENAI_PROJECT_ID_DIRECT } : {}),
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ],
          temperature: 0.1,
          max_tokens: 120,
        }),
      });
      if (resp.ok) {
        const j = await resp.json().catch(()=>null);
        const content = j?.choices?.[0]?.message?.content?.trim();
        if (content) return Response.json({ answer: content, matches: candidates, nluProvider: "openai" });
      }
    } catch {}
    // If direct OpenAI failed, continue to normal logic
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

  // If no clear flight intent, do lightweight RAG over IST pages
  // If query clearly refers to general topics, never treat as flight
  const generalGuard = /(bagaj|bavul|otopark|havaist|taksi|otob[uü]s|wifi|wi\-?fi|loung[e]?|harita|rehber|sss|sıkça|adres|konum|nerede|duty\s?free|ma[gğ]aza|yeme|i[cç]e|restoran)/i.test(query);
  const looksLikeFlight = /\b[a-z]{2}\s?\d{2,4}\b/i.test(normalized) || hasFlightKeywords;

  // Location intent quick answer (avoid flight branch)
  const isLocationQ = /(nerede|adres|konum|nasil giderim|nasıl giderim|where is|address|location)/i.test(query);
  if (isLocationQ) {
    const addrTr = "İstanbul Havalimanı (IST) adresi: Tayakadın, Terminal Caddesi No:1, 34283 Arnavutköy/İstanbul";
    const addrEn = "Istanbul Airport (IST) address: Tayakadin, Terminal Caddesi No:1, 34283 Arnavutkoy/Istanbul, Türkiye";
    const sources = [
      "https://www.istairport.com/ulasim/",
      "https://maps.app.goo.gl/qe3b1Zz6YtJw3J7b8",
    ];
    const answer = lang === "tr"
      ? `${addrTr}\n\nUlaşım: Havaist, taksi ve otobüs hatları için 'Ulaşım' sayfasına bakabilirsiniz.\n\nKaynaklar:\n- Ulaşım: ${sources[0]}\n- Harita: ${sources[1]}`
      : `${addrEn}\n\nTransport: See 'Transportation' page for Havaist shuttles, taxis and buses.\n\nSources:\n- Transport: ${sources[0]}\n- Map: ${sources[1]}`;
    return Response.json({ answer, matches: [], nluProvider: nluProvider ?? "rules" });
  }
  if (!looksLikeFlight) {
    // 0) Try fast FAQ CSV answer
    try {
      const faq = await loadFAQ();
      if (faq.length) {
        const nq = normalizeText(query, lang);
        const scored = faq.map((x, i) => ({ i, s: similarity(nq, normalizeText(lang === 'en' ? (x.q_en || x.q) : x.q, lang)) }))
          .sort((a,b)=> b.s - a.s);
        const bestIdx = scored.length ? scored[0].i : -1;
        const best = scored.length ? scored[0].s : 0;
        if (bestIdx >= 0 && best >= 0.20) {
          const item = faq[bestIdx];
          const ansRaw = (lang === 'en' ? (item.a_en || '') : item.a).trim();
          if (ansRaw) {
            return Response.json({ answer: ansRaw, matches: [], nluProvider: "faq-csv", faq: { score: best, q: (lang === 'en' ? (item.q_en || item.q) : item.q) } });
          }
          if (lang === 'en' && (item.a || '').trim()) {
            const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
            const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
            if (OPENAI_API_KEY_FAQ) {
              try {
                const resp = await fetch("https://api.openai.com/v1/chat/completions", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`, "Content-Type": "application/json", ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}) },
                  body: JSON.stringify({ model: "gpt-4o-mini", messages: [ { role: "system", content: "Translate the following Turkish answer into clear, concise English. Do not add or remove information. Preserve line breaks." }, { role: "user", content: item.a } ], temperature: 0.1, max_tokens: 120 })
                });
                if (resp.ok) {
                  const j = await resp.json().catch(()=>null);
                  const content = j?.choices?.[0]?.message?.content?.trim();
                  if (content) return Response.json({ answer: content, matches: [], nluProvider: "faq-translate", faq: { score: best, q: (item.q_en || item.q) } });
                }
              } catch {}
            }
            return Response.json({ answer: item.a, matches: [], nluProvider: "faq-tr-fallback", faq: { score: best, q: item.q } });
          }
        }
        // Weak match policy:
        // - For EN queries: do NOT compose an answer from facts. Pick the best FAQ and translate its TR answer deterministically.
        // - For TR queries: allow FACTS-based phrasing as before.
        if (lang === 'en' && scored.length) {
          const bestIdx2 = scored[0].i;
          const item = faq[bestIdx2];
          const trAns = (item.a || '').trim();
          if (trAns) {
            const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
            const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
            if (OPENAI_API_KEY_FAQ) {
              try {
                const resp = await fetch("https://api.openai.com/v1/chat/completions", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`, "Content-Type": "application/json", ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}) },
                  body: JSON.stringify({ model: "gpt-4o-mini", messages: [ { role: "system", content: "Translate the following Turkish answer into clear, concise English. Do not add or remove information. Preserve line breaks." }, { role: "user", content: trAns } ], temperature: 0.0 })
                });
                if (resp.ok) {
                  const j = await resp.json().catch(()=>null);
                  const content = j?.choices?.[0]?.message?.content?.trim();
                  if (content) return Response.json({ answer: content, matches: [], nluProvider: "faq-translate-weak", faq: { q: item.q } });
                }
              } catch {}
            }
            // If translation not possible, return TR answer as-is
            return Response.json({ answer: trAns, matches: [], nluProvider: "faq-tr-fallback", faq: { q: item.q } });
          }
        } else {
          const OPENAI_API_KEY_FAQ = process.env.OPENAI_API_KEY?.trim();
          const OPENAI_PROJECT_ID_FAQ = process.env.OPENAI_PROJECT_ID?.trim();
          if (OPENAI_API_KEY_FAQ && scored.length) {
            const topFacts = scored.slice(0, 3).map(({i},k)=>`[${k+1}] Q: ${faq[i].q}\nA: ${faq[i].a}`).join("\n\n");
            const system = lang === "tr"
              ? "İstanbul Havalimanı genel danışma asistanısın. Aşağıdaki FAQ FACTS verilerini temel alarak kısa ve net bir cevap oluştur. Sadece verilen bilgilerden yararlan, uydurma bilgi verme."
              : "You are an Istanbul Airport assistant. Using only the FAQ FACTS below, produce a short, accurate answer. Do not fabricate.";
            const userMsg = `${query}\n\nFAQ FACTS:\n${topFacts}`;
            try {
              const resp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${OPENAI_API_KEY_FAQ}`,
                  "Content-Type": "application/json",
                  ...(OPENAI_PROJECT_ID_FAQ ? { "OpenAI-Project": OPENAI_PROJECT_ID_FAQ } : {}),
                },
                body: JSON.stringify({
                  model: "gpt-4o-mini",
                  messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ],
                  temperature: 0.1,
                }),
              });
              if (resp.ok) {
                const j = await resp.json().catch(()=>null);
                const content = j?.choices?.[0]?.message?.content?.trim();
                if (content) {
                  return Response.json({ answer: content, matches: [], nluProvider: "faq-openai" });
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // Cache check
    const cacheKey = `${lang}|${strip(query)}`;
    const cached = ragCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DAY_MS) {
      return Response.json({ answer: cached.answer, matches: [], nluProvider: nluProvider ?? "rag-cache" });
    }
    try {
      const normQ = strip(query);
      const terms = normQ.split(" ").filter(w => w.length > 2);
      const topicBoost = /(bagaj|bavul|otopark|havaist|wifi|loung|check|harita|rehber|sss|sikca|sıkça)/.test(normQ) ? 1 : 0;
      function variants(t: string): string[] {
        const base = t.replace(/(lari|leri|larin|lerin|larda|lerde|dan|den|e|a|i|ı|u|ü|y|nin|nın|nun|nün)$/,'');
        const uniq = new Set([t, base, base.replace(/(li|lı|lu|lü)$/,'')]);
        return [...uniq].filter(Boolean) as string[];
      }
      type Hit = { score: number; snippet: string; url: string; title?: string };
      const hits: Hit[] = [];
      // Fetch a subset in parallel (cap to 8 for speed)
      const pages = IST_ALLOWED_PAGES.slice(0, 4);
      const resps = await Promise.allSettled(
        pages.map(p => fetch(p.url, { cache: "no-store" })
          .then(r => r.text())
          .then(t => ({ html: t, url: p.url, title: p.title }))
        )
      );
      for (const r of resps) {
        if (r.status !== "fulfilled") continue;
        const { html, url, title } = r.value as { html: string; url: string; title?: string };
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const norm = text.toLowerCase();
        const chunks = text.split(/(?<=[.!?])\s+/u).slice(0, 600);
        for (const ch of chunks) {
          // term scoring: fuzzy Turkish endings
          let matchCount = 0; let score = 0;
          for (const t of terms) {
            if (!t) continue;
            const vars = variants(t);
            if (vars.some(v => v && (norm.includes(v) || norm.startsWith(v)))) {
              matchCount++; score += 2;
            }
          }
          // URL/title relevance boosts (and topic-specific boosts)
          const meta = (url + ' ' + (title||'')).toLowerCase();
          if (/ulasim|otopark|wifi|bagaj|kayıp|lost|lounge|check|harita|yeme|magaza|duty|sss|sikca|sıkça/.test(meta)) score += 2;
          if (/(bagaj|bavul)/.test(norm)) score += 2;
          score += topicBoost; // slight global boost when topic words exist in query
          // downrank homepage heavily
          if (/^https:\/\/www\.istairport\.com\/?$/.test(url)) score -= 4;
          if (matchCount >= Math.min(2, terms.length)) {
            hits.push({ score, snippet: ch.trim().slice(0, 400), url, title });
          }
        }
      }
      // Deduplicate by snippet and url
      const uniq: Hit[] = [];
      const seen = new Set<string>();
      for (const h of hits.sort((a,b)=> b.score - a.score)) {
        const key = h.url + '|' + h.snippet.slice(0,120);
        if (seen.has(key)) continue;
        seen.add(key); uniq.push(h);
      }
      const top = uniq.slice(0, 4);
      if (top.length) {
        const answerText = top.map(h => `• ${h.snippet}`).join("\n\n");
        const srcSeen = new Set<string>();
        const sources = top
          .filter(h => { if (srcSeen.has(h.url)) return false; srcSeen.add(h.url); return true; })
          .map(h => `- ${h.title ?? "Kaynak"}: ${h.url}`).join("\n");
        let answer = lang === "tr"
          ? `${answerText}\n\nKaynaklar:\n${sources}`
          : `${answerText}\n\nSources:\n${sources}`;

        // Synthesize with OpenAI if key exists

        // Optional: Synthesize with OpenAI if key exists
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
        const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID?.trim();
        if (OPENAI_API_KEY) {
          try {
            const system = lang === "tr"
              ? "Aşağıdaki pasajlardan yararlanarak kullanıcı sorusuna kısa, doğru ve kaynaklara referans veren net bir cevap üret. Kaynakları 'Kaynaklar:' başlığı altında madde madde bırak. Uydurma bilgi verme."
              : "Using the provided passages, produce a short, accurate answer that cites sources under 'Sources:'. Do not fabricate.";
            const userMsg = `${query}\n\nPASSAGES:\n${top.map((h,i)=>`[${i+1}] ${h.snippet} (${h.url})`).join("\n")}`;
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
                ...(OPENAI_PROJECT_ID ? { "OpenAI-Project": OPENAI_PROJECT_ID } : {}),
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ],
                temperature: 0.1,
                max_tokens: 120,
              }),
            });
            const j = await resp.json().catch(() => null);
            const content = j?.choices?.[0]?.message?.content?.trim();
            if (content) answer = content;
          } catch {}
        }

        ragCache.set(cacheKey, { at: Date.now(), answer });
        return Response.json({ answer, matches: [], nluProvider: nluProvider ?? "rag" });
      }
      // No passages found: fall back to a brief default
    } catch {}
    // As last resort
    return Response.json({ answer: lang === "tr" ? "Bu konuda bilgi bulamadım. Lütfen sorunuzu farklı ifade edin." : "I couldn't find information on this. Please rephrase your question." });
  }

  // 0) Build flight list from ISTAirport live proxy (both directions, domestic & international)
  async function loadLiveFlights(forceAllScopes: boolean = false, allowCache: boolean = true): Promise<Flight[]> {
    // Fast path: serve from cache if fresh
    if (allowCache && liveFlightsCache && (Date.now() - liveFlightsCache.at) < FLIGHT_CACHE_TTL_MS) {
      return liveFlightsCache.flights;
    }
    const directions: Array<{ nature: string; direction: FlightDirection }> = [
      { nature: "1", direction: "Departure" },
      { nature: "0", direction: "Arrival" },
    ];
    const scopes = forceAllScopes ? ["0", "1"] : (scope ? [scope === "international" ? "1" : "0"] : ["0", "1"]); // 0: domestic, 1: international

    // Build parallel tasks for all combinations
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

    const settled = await Promise.allSettled(tasks);
    // Merge unique flights via Map in one pass
    const uniqueFlights = Array.from(
      new Map(
        settled
          .filter((r): r is PromiseFulfilledResult<Flight[]> => r.status === "fulfilled")
          .flatMap((r) => r.value)
          .map((f) => [`${f.flightNumber}-${f.scheduledTimeLocal}-${f.direction}`, f] as const)
      ).values()
    );

    if (allowCache) {
      liveFlightsCache = { at: Date.now(), flights: uniqueFlights };
      // Background prefetch before TTL expires to keep cache hot
      setTimeout(() => { loadLiveFlights(true, false).catch(() => {}); }, Math.max(1_000, FLIGHT_CACHE_TTL_MS - 60_000));
    }
    return uniqueFlights;
  }

  // Parallelize DB + Live and prefer whichever arrives with data
  const [dbRes, liveRes] = await Promise.allSettled([
    fetchFlightsFromDbCached(),
    loadLiveFlights()
  ]);
  const dbFlights = dbRes.status === 'fulfilled' ? dbRes.value : [];
  const liveFlights = liveRes.status === 'fulfilled' ? liveRes.value : [];
  let allFlights: Flight[] = liveFlights.length ? liveFlights : (dbFlights.length ? dbFlights : staticFlights);

  // Fuzzy filter: score on flightNumber, city (origin/dest), airline
  const qFlight = (merged.flightNumber || "").toUpperCase();
  const qCity = merged.city ? strip(merged.city) : "";
  const wantDir = wantDirDefault;
  // Build tokens from query to match multi-word cities (e.g., "kocaseyit edremit")
  const stopWords = new Set(["ucus","ucusu","uclus","ucuslar","uçuş","uçuşu","uçuşlar","ne","zaman","kalkis","kalkış","varis","varış","gelen","giden","gate","kapi","kapı","hangi","mi","mı","mu","mü","when","time","flight","to","from"]);
  const tokens = normalized.split(" ")
    .filter(w => w.length >= 3 && !stopWords.has(w));
  function score(f: Flight): number {
    let s = 0;
    if (wantDir && f.direction === wantDir) s += 3;
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
    return s;
  }
  const scored = allFlights.map(f => ({ f, s: score(f) }));
  const top = scored.filter(x => x.s > 0).sort((a,b) => b.s - a.s).slice(0, 20).map(x => x.f);
  const prelim = top.length ? top : filterFlights(allFlights, { type: wantDir, city: merged.city, flightNumber: merged.flightNumber });
  // Prefer chosen direction first
  const dirFiltered = wantDir ? prelim.filter(f => f.direction === wantDir) : prelim;
  // Prefer earliest upcoming flight(s) by time (>= now - 5m), then fallback to time asc
  const nowTs = Date.now();
  const future = dirFiltered.filter(f => {
    try { return new Date(f.scheduledTimeLocal).getTime() >= nowTs - 5*60*1000; } catch { return true; }
  }).sort((a,b) => {
    try { return new Date(a.scheduledTimeLocal).getTime() - new Date(b.scheduledTimeLocal).getTime(); } catch { return 0; }
  });
  let result = (future.length ? future : dirFiltered).slice(0, 50);

  // STRICT CITY/TOKEN FILTER: keep only flights that actually match the asked city/tokens
  if (qCity || tokens.length) {
    const filtered = result.filter(f => {
      const oc = strip(f.originCity);
      const dc = strip(f.destinationCity);
      const cityHit = qCity ? (oc === qCity || dc === qCity || oc.startsWith(qCity) || dc.startsWith(qCity) || oc.includes(qCity) || dc.includes(qCity)) : false;
      const tokenCount = tokens.reduce((acc,t)=> acc + ((oc.includes(t) || dc.includes(t)) ? 1 : 0), 0);
      if (qCity && tokens.length >= 2) return cityHit || tokenCount >= 2;
      if (qCity) return cityHit;
      if (tokens.length >= 2) return tokenCount >= 2; // multi-word names need stronger match
      return tokenCount >= 1;
    });
    if (filtered.length) result = filtered;
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

  if (result.length === 0) {
    // Graceful fallback: ask OpenAI to answer anyway
    const OPENAI_API_KEY_FALL = process.env.OPENAI_API_KEY?.trim();
    const OPENAI_PROJECT_ID_FALL = process.env.OPENAI_PROJECT_ID?.trim();
    if (OPENAI_API_KEY_FALL) {
      try {
        // Build a light candidate list from tokens to help the model (if any)
        const cand = tokens.length ? allFlights.filter(f => {
          const oc = strip(f.originCity); const dc = strip(f.destinationCity);
          return tokens.some(t => oc.includes(t) || dc.includes(t));
        }).sort((a,b)=>{
          try { return new Date(a.scheduledTimeLocal).getTime() - new Date(b.scheduledTimeLocal).getTime(); } catch { return 0; }
        }).slice(0,5) : [];
        const fmtTimeLocal = (s?: string) => { try { return s ? new Date(s).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", {hour:"2-digit",minute:"2-digit"}) : ""; } catch { return s||""; } };
        const facts = cand.map((f,i)=>`[${i+1}] ${f.flightNumber} ${(f.direction === "Arrival" ? f.originCity : f.destinationCity)} ${fmtTimeLocal(f.scheduledTimeLocal)}${f.estimatedTimeLocal?` / ${fmtTimeLocal(f.estimatedTimeLocal)}`:""}${f.direction === "Departure" ? (f.gate?`, Gate ${f.gate}`:"") : (f.baggage?`, ${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}`:"")} — ${f.status}`).join("\n");
        const system = lang === "tr"
          ? "İstanbul Havalimanı uçuş asistanısın. Kullanıcının sorusunu kibarca yanıtla. Eşleşen sonuç yoksa olası nedenleri (yazım, yön/terminal, tarih) kısa belirt; mümkünse en yakın ilgili uçuşları öner. Uydurma bilgi verme."
          : "You are an assistant for Istanbul Airport. Politely answer. If no exact match, briefly mention possible reasons (spelling, direction/terminal, date) and suggest the closest relevant flights if available. Do not fabricate.";
        const userMsg = facts
          ? `${query}\n\nPOSSIBLE FLIGHTS:\n${facts}`
          : query;
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY_FALL}`,
            "Content-Type": "application/json",
            ...(OPENAI_PROJECT_ID_FALL ? { "OpenAI-Project": OPENAI_PROJECT_ID_FALL } : {}),
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ],
            temperature: 0.2,
          }),
        });
        if (resp.ok) {
          const j = await resp.json().catch(()=>null);
          const content = j?.choices?.[0]?.message?.content?.trim();
          if (content) {
            return Response.json({ answer: content, matches: cand, nluProvider });
          }
        }
      } catch {}
    }
    return Response.json({
      answer: lang === "tr" ? "Uçuş bulunamadı. Lütfen uçuş numarası veya şehir adını netleştirerek tekrar dener misiniz?" : "No matching flights found. Please try again with a flight number or clearer city name.",
      matches: [],
      nluProvider,
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

  // If OpenAI is available, let it produce the final phrasing using the same flight facts
  const OPENAI_API_KEY_FLIGHTS = process.env.OPENAI_API_KEY?.trim();
  const OPENAI_PROJECT_ID_FLIGHTS = process.env.OPENAI_PROJECT_ID?.trim();
  if (OPENAI_API_KEY_FLIGHTS && !wantsList) {
    try {
      const system = lang === "tr"
        ? "İstanbul Havalimanı uçuş asistanısın. Kullanıcının sorusunu ve UÇUŞ BİLGİLERİ listesini kullanarak tek cümlede net bir yanıt ver. Zamanı HH:MM biçiminde yaz; kapı veya bagaj bilgisini ekle. Uydurma bilgi verme."
        : "You are an assistant for Istanbul Airport. Using the user's question and the FLIGHT FACTS, produce one concise sentence with the key time/gate/baggage. Do not fabricate.";
      const facts = result.slice(0, 5).map((f, i) => (
        `[${i+1}] ${f.flightNumber} ${f.direction === "Arrival" ? f.originCity : f.destinationCity} ` +
        `${fmtTime(f.scheduledTimeLocal)}${f.estimatedTimeLocal ? ` / ${fmtTime(f.estimatedTimeLocal)}` : ""}` +
        `${f.direction === "Departure" ? (f.gate ? `, Gate ${f.gate}` : "") : (f.baggage ? `, ${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}` : "")} — ${f.status}`
      )).join("\n");
      const userMsg = `${query}\n\nFLIGHT FACTS:\n${facts}`;
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY_FLIGHTS}`,
          "Content-Type": "application/json",
          ...(OPENAI_PROJECT_ID_FLIGHTS ? { "OpenAI-Project": OPENAI_PROJECT_ID_FLIGHTS } : {}),
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [ { role: "system", content: system }, { role: "user", content: userMsg } ],
          temperature: 0.2,
        }),
      });
      if (resp.ok) {
        const j = await resp.json().catch(() => null);
        const content = j?.choices?.[0]?.message?.content?.trim();
        if (content) answer = content;
      }
    } catch {}
  }

  const finalData = { answer, matches: result, nluProvider };
  // Store quick cache for repeated queries
  try { quickRespCache.set(quickKey, { at: Date.now(), data: finalData }); } catch {}
  return Response.json(finalData);
}