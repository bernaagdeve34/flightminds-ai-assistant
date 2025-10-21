import { NextRequest } from "next/server";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import type { Flight, FlightDirection } from "@/lib/types";
import { extractQueryWithGemini, extractQueryWithGeminiMeta } from "@/lib/ai/gemini";
import { extractQueryWithGroq, extractQueryWithGroqMeta } from "@/lib/ai/groq";
import { extractQueryWithRules } from "@/lib/ai/rules";
import { readJson } from "@/lib/diskCache";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query: string = body?.query ?? "";
  const lang: "tr" | "en" = body?.lang === "en" ? "en" : "tr";
  const wantDebug: boolean = !!body?.debug;

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
  const cityMatch = normalized.match(/\b([a-z]{3,})\b/i);

  const merged = {
    city: city ?? cityMatch?.[1],
    type: type ?? (isArrival ? "Arrival" : isDeparture ? "Departure" : undefined),
    flightNumber: flightNumber ?? flightNumMatch?.[1],
  };

  // 0) Build flight list from ISTAirport live proxy (both directions, domestic & international)
  async function loadLiveFlights(): Promise<Flight[]> {
    const directions: Array<{ nature: string; direction: FlightDirection }> = [
      { nature: "1", direction: "Departure" },
      { nature: "0", direction: "Arrival" },
    ];
    const scopes = ["0", "1"]; // 0: domestic, 1: international

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
          const resp = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/istairport/status`, {
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
      if (oc === qCity || dc === qCity) s += 4;
      else if (oc.includes(qCity) || dc.includes(qCity)) s += 2;
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
  const answer = lang === "tr"
    ? (result.length > 1 ? `Birden fazla eşleşme var:\n${lines.join("\n")}\nHangi uçuşu istiyorsunuz?` : `Uçuş: ${lines[0]}`)
    : (result.length > 1 ? `There are multiple matches:\n${lines.join("\n")}\nWhich flight do you mean?` : `Flight: ${lines[0]}`);

  return Response.json({ answer, matches: result, gemini: geminiMeta ?? undefined, nluProvider });
}
