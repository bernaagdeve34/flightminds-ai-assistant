import { NextRequest } from "next/server";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import type { Flight, FlightDirection } from "@/lib/types";
import { extractQueryWithGemini, extractQueryWithGeminiMeta } from "@/lib/ai/gemini";
import { extractQueryWithGroq, extractQueryWithGroqMeta } from "@/lib/ai/groq";
import { extractQueryWithRules } from "@/lib/ai/rules";
import { readJson } from "@/lib/diskCache";
import { IST_ALLOWED_PAGES } from "@/lib/content/istPages";

// Simple in-memory cache for RAG answers (resets on redeploy)
const ragCache = new Map<string, { at: number; answer: string }>();
const DAY_MS = 24 * 60 * 60 * 1000;

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

  // 0-a) If forced, route ALL questions directly to Gemini and return
  const GEMINI_ONLY = String(process.env.GEMINI_ONLY || "").toLowerCase() === "true";
  const GEMINI_API_KEY_DIRECT = process.env.GEMINI_API_KEY?.trim();
  if (GEMINI_ONLY && GEMINI_API_KEY_DIRECT) {
    try {
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
      const version = "v1beta";
      const system = lang === "tr"
        ? "İstanbul Havalimanı için konuşan bir asistansın. Kullanıcının sorusuna kısa, net ve doğru bir yanıt ver. Uydurma bilgi verme."
        : "You are an assistant for Istanbul Airport. Provide a short, accurate answer. Do not fabricate.";
      const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_API_KEY_DIRECT}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: system }] },
            { role: "user", parts: [{ text: query }] },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const gx = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
        if (gx) {
          return Response.json({ answer: gx.trim(), matches: [], nluProvider: "gemini-direct" });
        }
      } else if (wantDebug) {
        const txt = await resp.text().catch(() => "");
        return Response.json({
          answer: lang === "tr" ? "Gemini yanıtı alınamadı (debug)." : "Gemini response failed (debug).",
          matches: [],
          nluProvider: "gemini-direct",
          debug: { geminiDirect: { status: resp.status, body: txt?.slice(0, 800) } }
        });
      }
    } catch {}
    // If direct Gemini failed, continue to normal logic
  }

  // Early flight-like detection to optionally bypass OPENAI_ONLY short-circuit
  const earlyStrip = (s: string) => s
    .toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim();
  const earlyNorm = earlyStrip(query);
  const flightLike = (/(ucus|uçus|uçuş|sefer|gate|kapi|kapı|kalkis|kalkış|varis|varış|giden|gelen|terminal|flight|flt|uçuş\s*no|flight\s*no)/.test(earlyNorm)
    || /\b[a-z]{2}\s?\d{2,4}\b/i.test(query));

  // 0-b) If forced, route ALL questions directly to OpenAI and return
  const OPENAI_ONLY = String(process.env.OPENAI_ONLY || "").toLowerCase() === "true";
  const OPENAI_API_KEY_DIRECT = process.env.OPENAI_API_KEY?.trim();
  const OPENAI_PROJECT_ID_DIRECT = process.env.OPENAI_PROJECT_ID?.trim();
  if (OPENAI_ONLY && OPENAI_API_KEY_DIRECT && !flightLike) {
    try {
      const system = lang === "tr"
        ? "İstanbul Havalimanı için konuşan bir asistansın. Kullanıcının sorusuna kısa, net ve doğru bir yanıt ver. Uydurma bilgi verme."
        : "You are an assistant for Istanbul Airport. Provide a short, accurate answer. Do not fabricate.";
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY_DIRECT}`,
          "Content-Type": "application/json",
          ...(OPENAI_PROJECT_ID_DIRECT ? { "OpenAI-Project": OPENAI_PROJECT_ID_DIRECT } : {}),
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [ { role: "system", content: system }, { role: "user", content: query } ],
          temperature: 0.2,
        }),
      });
      if (resp.ok) {
        const j = await resp.json().catch(() => null);
        const content = j?.choices?.[0]?.message?.content?.trim();
        if (content) return Response.json({ answer: content, matches: [], nluProvider: "openai-direct" });
      } else if (wantDebug) {
        const txt = await resp.text().catch(() => "");
        return Response.json({
          answer: lang === "tr" ? "OpenAI yanıtı alınamadı (debug)." : "OpenAI response failed (debug).",
          matches: [],
          nluProvider: "openai-direct",
          debug: { openaiDirect: { status: resp.status, body: txt?.slice(0, 800) } }
        });
      }
    } catch {}
    // If direct OpenAI failed, continue to normal logic
  }

  // 1) Try NLU providers: Gemini -> Groq -> Rules
  let nluProvider: "gemini" | "groq" | "rules" | undefined;
  let nlu = await extractQueryWithGemini(query);
  const geminiMeta = wantDebug ? await extractQueryWithGeminiMeta(query) : null;
  if (nlu) {
    nluProvider = "gemini";
  } else {
    const groq = await extractQueryWithGroq(query);
    if (groq) {
      nlu = groq;
      nluProvider = "groq";
    } else {
      const rules = extractQueryWithRules(query);
      if (rules.city || rules.type || rules.flightNumber) {
        nlu = rules;
        nluProvider = "rules";
      }
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
  const hasFlightKeywords = /(\bucus\b|\buçuş\b|\bsefer\b|\bgate\b|\bkapi\b|\bkapı\b|\bkalkis\b|\bkalkış\b|\bvaris\b|\bvarış\b|\bgiden\b|\bgelen\b|\bterminal\b|\bflt\b|\bflight\b)/.test(normalized);
  // Şehir çıkarımını gelişi güzel yapmayalım; ancak uçuş niyeti varsa dene
  const cityMatch = hasFlightKeywords ? normalized.match(/\b([a-z]{3,})\b/i) : null;

  const allowNluFlight = hasFlightKeywords || !!flightNumMatch;
  const merged = {
    city: city ?? (hasFlightKeywords ? cityMatch?.[1] : undefined),
    type: (isArrival ? "Arrival" : isDeparture ? "Departure" : undefined) ?? (allowNluFlight ? type : undefined),
    flightNumber: flightNumber ?? flightNumMatch?.[1],
  };

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
  const looksLikeFlight = !GEMINI_ONLY && !generalGuard && !!(merged.type || merged.flightNumber || hasFlightKeywords || /\btk\s?\d{2,4}\b/i.test(normalized));

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
      const pages = IST_ALLOWED_PAGES.slice(0, 20);
      const resps = await Promise.allSettled(pages.map(p => fetch(p.url, { cache: "no-store" }).then(r => r.text()).then(t => ({ html: t, url: p.url, title: p.title }))));
      for (const r of resps) {
        if (r.status !== "fulfilled") continue;
        const { html, url, title } = r.value as any;
        const text = htmlToText(html);
        // Split to sentences/short paragraphs
        const chunks = text.split(/(?<=[\.!\?])\s+/u).slice(0, 1200);
        for (const ch of chunks) {
          const norm = strip(ch);
          // skip very short or menu-like paragraphs
          if (norm.length < 40) continue;
          if (/(tr\s*en|english|zh|ru|ar|de|fr|es)\b/.test(norm)) continue;
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

        // Optional: Synthesize with Gemini first (if key exists), otherwise OpenAI, otherwise Groq
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
        if (GEMINI_API_KEY) {
          try {
            const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
            const version = "v1beta";
            const system = lang === "tr"
              ? "İstanbul Havalimanı asistanısın. Aşağıdaki pasajlara dayanarak kısa, doğru ve kaynaklı bir yanıt ver. Uydurma bilgi verme. En sonda 'Kaynaklar:' başlığı altında maddeler halinde linkleri bırak."
              : "You are an assistant for Istanbul Airport. Using the passages below, produce a short, accurate, sourced answer. Do not fabricate. End with 'Sources:' listing the links.";
            const userMsg = `${query}\n\nPASSAGES:\n${top.map((h,i)=>`[${i+1}] ${h.snippet} (${h.url})`).join("\n")}`;
            const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  { role: "user", parts: [{ text: system }] },
                  { role: "user", parts: [{ text: userMsg }] },
                ],
                generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
              }),
            });
            if (resp.ok) {
              const data = await resp.json();
              const gx = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
              if (gx) answer = gx.trim();
            }
          } catch {}
        }

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
                temperature: 0.2,
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
      // No passages found: ask Gemini/OpenAI/Groq directly (as last resort)
      const GEMINI_API_KEY2 = process.env.GEMINI_API_KEY?.trim();
      if (GEMINI_API_KEY2) {
        try {
          const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
          const version = "v1beta";
          const system = lang === "tr"
            ? "İstanbul Havalimanı (IST) asistanısın. Soruyu kısaca yanıtla. Bilmiyorsan uydurma, 'Buna dair kesin bilgi bulamadım' de ve ilgili sayfaya yönlendir."
            : "You are an assistant for Istanbul Airport (IST). Answer briefly. If uncertain, say you couldn't find definitive info and suggest the relevant page.";
          const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_API_KEY2}`;
          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [ { role: "user", parts: [{ text: system }] }, { role: "user", parts: [{ text: query }] } ], generationConfig: { temperature: 0.2, maxOutputTokens: 200 } }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const gx = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
            if (gx) return Response.json({ answer: gx.trim(), matches: [], nluProvider: nluProvider ?? "gemini-direct" });
          }
        } catch {}
      }
    } catch {}
    // As last resort
    return Response.json({ answer: lang === "tr" ? "Bu konuda bilgi bulamadım. Lütfen sorunuzu farklı ifade edin." : "I couldn't find information on this. Please rephrase your question." });
  }

  // 0) Build flight list from ISTAirport live proxy (both directions, domestic & international)
  async function loadLiveFlights(): Promise<Flight[]> {
    const directions: Array<{ nature: string; direction: FlightDirection }> = [
      { nature: "1", direction: "Departure" },
      { nature: "0", direction: "Arrival" },
    ];
    const scopes = scope ? [scope === "international" ? "1" : "0"] : ["0", "1"]; // 0: domestic, 1: international

    const results: Flight[] = [];
    for (const d of directions) {
      for (const isInternational of scopes) {
        const body = new URLSearchParams({
          nature: d.nature,
          searchTerm: "",
          pageSize: "100",
          isInternational,
          date: "",
          endDate: "",
          culture: lang === "tr" ? "tr" : "en",
          clickedButton: "",
        }).toString();
        try {
          const resp = await fetch(`${thisOrigin}/api/istairport/status`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            cache: "no-store",
            body,
          });
          const json = await resp.json().catch(() => ({} as any));
          const flights: any[] = (json?.data ?? json)?.result?.data?.flights || [];
          const statusMap = (s?: string) => {
            const v = (s || "").toLowerCase();
            if (v.includes("iptal") || v.includes("cancel")) return "Cancelled" as const;
            if (v.includes("gecik") || v.includes("delay")) return "Delayed" as const;
            if (v.includes("indi") || v.includes("land")) return "Landed" as const;
            if (v.includes("erken") || v.includes("early")) return "Early" as any;
            return "On Time" as const;
          };
          for (const f of flights) {
            results.push({
              id: `${String(f?.flightNumber)}-${d.direction === "Arrival" ? "ARR" : "DEP"}-${String(f?.scheduledDatetime)}`,
              airportCode: "IST",
              flightNumber: String(f?.flightNumber || ""),
              airline: String(f?.airlineName || f?.airlineCode || ""),
              direction: d.direction,
              originCity: String(f?.fromCityName || f?.fromCityCode || ""),
              destinationCity: String(f?.toCityName || f?.toCityCode || ""),
              scheduledTimeLocal: String(f?.scheduledDatetime || ""),
              estimatedTimeLocal: f?.estimatedDatetime ? String(f?.estimatedDatetime) : undefined,
              status: statusMap(f?.remark || f?.remarkCode),
              gate: d.direction === "Departure" ? (f?.gate ? String(f.gate) : undefined) : undefined,
              baggage: d.direction === "Arrival" ? (f?.carousel ? String(f.carousel) : undefined) : undefined,
            } as Flight);
          }
        } catch {
          // ignore this combination
        }
      }
    }
    // Deduplicate by flightNumber + scheduled
    const seen = new Set<string>();
    return results.filter((f) => {
      const k = `${f.flightNumber}-${f.scheduledTimeLocal}-${f.direction}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  let allFlights: Flight[] = await loadLiveFlights();
  if (!allFlights.length) {
    // Fallback to DB or static as last resort
    allFlights = (await fetchFlightsFromDb()).length ? await fetchFlightsFromDb() : staticFlights;
  }

  // Fuzzy filter: score on flightNumber, city (origin/dest), airline
  const qFlight = (merged.flightNumber || "").toUpperCase();
  const qCity = merged.city ? strip(merged.city) : "";
  const wantDir = merged.type;
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
  const top = scored.filter(x => x.s > 0).sort((a,b) => b.s - a.s).slice(0, 10).map(x => x.f);
  const result = top.length ? top : filterFlights(allFlights, { type: wantDir, city: merged.city, flightNumber: merged.flightNumber });

  if (result.length === 0) {
    return Response.json({
      answer: lang === "tr" ? "Uçuş bulunamadı." : "No matching flights found.",
      matches: [],
      gemini: geminiMeta ?? undefined,
      nluProvider,
    });
  }

  const fmtTime = (s?: string) => {
    if (!s) return "";
    try { const d = new Date(s); return d.toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" }); } catch { return s; }
  };
  const lines = result.slice(0, 5).map((f) => {
    const cityText = f.direction === "Arrival" ? f.originCity : f.destinationCity;
    const gateOrBaggage = f.direction === "Departure" ? (f.gate ? `Gate ${f.gate}` : "") : (f.baggage ? `${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}` : "");
    const timePair = `${fmtTime(f.scheduledTimeLocal)}${f.estimatedTimeLocal ? ` / ${fmtTime(f.estimatedTimeLocal)}` : ""}`;
    return `${f.flightNumber} ${cityText} ${timePair}${gateOrBaggage ? `, ${gateOrBaggage}` : ""} — ${f.status}`;
  });
  // Varsayılan davranış: en iyi tek uçuşu kısa dön, kullanıcı özellikle liste isterse listele (naif kontrol)
  const wantsList = /listele|list/gi.test(query);
  const bestLine = lines[0];
  let answer = wantsList
    ? (lang === "tr" ? `Birden fazla eşleşme var:\n${lines.join("\n")}\nHangi uçuşu istiyorsunuz?` : `There are multiple matches:\n${lines.join("\n")}\nWhich flight do you mean?`)
    : (lang === "tr" ? `Uçuş: ${bestLine}` : `Flight: ${bestLine}`);

  // If Gemini is available, let it produce the final phrasing using flight facts
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
  if (GEMINI_API_KEY) {
    try {
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
      const version = "v1beta";
      const system = lang === "tr"
        ? "İstanbul Havalimanı uçuş asistanısın. Kullanıcı sorusunu ve aşağıdaki UÇUŞ BİLGİLERİ listesini kullanarak tek cümlede net bir yanıt üret. Zamanı HH:MM biçiminde yaz. Uydurma bilgi verme."
        : "You are an assistant for Istanbul Airport. Using the user's question and the FLIGHT FACTS below, produce one concise sentence with the key time/gate/baggage. Do not fabricate.";
      const facts = result.slice(0, 5).map((f, i) => (
        `[${i+1}] ${f.flightNumber} ${f.direction === "Arrival" ? f.originCity : f.destinationCity} ` +
        `${fmtTime(f.scheduledTimeLocal)}${f.estimatedTimeLocal ? ` / ${fmtTime(f.estimatedTimeLocal)}` : ""}` +
        `${f.direction === "Departure" ? (f.gate ? `, Gate ${f.gate}` : "") : (f.baggage ? `, ${lang === "tr" ? "Bagaj" : "Baggage"} ${f.baggage}` : "")} — ${f.status}`
      )).join("\n");
      const userMsg = `${query}\n\nFLIGHT FACTS:\n${facts}`;
      const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: system }] },
            { role: "user", parts: [{ text: userMsg }] },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const gx = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
        if (gx) answer = gx.trim();
      }
    } catch {}
  }

  // If OpenAI is available, let it produce the final phrasing using the same flight facts
  const OPENAI_API_KEY_FLIGHTS = process.env.OPENAI_API_KEY?.trim();
  const OPENAI_PROJECT_ID_FLIGHTS = process.env.OPENAI_PROJECT_ID?.trim();
  if (OPENAI_API_KEY_FLIGHTS) {
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

  return Response.json({ answer, matches: result, gemini: geminiMeta ?? undefined, nluProvider });
}
