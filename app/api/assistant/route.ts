import { NextRequest } from "next/server";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import type { Flight } from "@/lib/types";
import { fetchIstFlightsFromAviationstack } from "@/lib/api/providers/aviationstack";
import { fetchIstFlightsFromAeroDataBox } from "@/lib/api/providers/aerodatabox";
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
  const normalized = query.toLowerCase();
  const isArrival = /gelen|var(ış|acak)|arriv(e|al)/.test(normalized);
  const isDeparture = /giden|kalk(ış|acak)|depart/.test(normalized);
  const flightNumMatch = normalized.match(/([a-z]{2}\d{2,4})/i);
  const cityMatch = normalized.match(/\b([a-zçğıöşü]{3,})\b/iu);

  const merged = {
    city: city ?? cityMatch?.[1],
    type: type ?? (isArrival ? "Arrival" : isDeparture ? "Departure" : undefined),
    flightNumber: flightNumber ?? flightNumMatch?.[1],
  };

  // 0) Build flight list: try disk cache first, then providers
  async function loadLiveFlights(): Promise<Flight[]> {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;

    // a) Try disk cache from API routes (fast & quota-free)
    const arrDisk = await readJson<{ rows: any[] }>(`arrivals:${date}`, 30 * 60 * 1000);
    const depDisk = await readJson<{ rows: any[] }>(`departures:${date}`, 30 * 60 * 1000);
    const fromDisk: Flight[] = [];
    for (const r of arrDisk.data?.rows ?? []) {
      fromDisk.push({
        id: `${r.flightNumber}-arr-${r.scheduled}`,
        airportCode: "IST",
        flightNumber: String(r.flightNumber || ""),
        airline: String(r.airline || ""),
        direction: "Arrival",
        originCity: String(r.departureAirport || ""),
        destinationCity: "Istanbul",
        scheduledTimeLocal: r.scheduled,
        estimatedTimeLocal: r.estimated,
        status: String(r.status || "On Time") as any,
        source: "cache:api:arrivals",
        fetchedAt: new Date().toISOString() as any,
        createdAt: new Date().toISOString() as any,
        updatedAt: new Date().toISOString() as any,
      } as Flight);
    }
    for (const r of depDisk.data?.rows ?? []) {
      fromDisk.push({
        id: `${r.flightNumber}-dep-${r.scheduled}`,
        airportCode: "IST",
        flightNumber: String(r.flightNumber || ""),
        airline: String(r.airline || ""),
        direction: "Departure",
        originCity: "Istanbul",
        destinationCity: String(r.destinationAirport || ""),
        scheduledTimeLocal: r.scheduled,
        estimatedTimeLocal: r.estimated,
        status: String(r.status || "On Time") as any,
        source: "cache:api:departures",
        fetchedAt: new Date().toISOString() as any,
        createdAt: new Date().toISOString() as any,
        updatedAt: new Date().toISOString() as any,
      } as Flight);
    }
    if (fromDisk.length) return fromDisk;

    // Try Aviationstack (today)
    let flights = await fetchIstFlightsFromAviationstack(date);
    if (!flights.length) {
      // Try Aviationstack without date (provider live/status queries inside adapter)
      flights = await fetchIstFlightsFromAviationstack();
    }
    if (!flights.length) {
      // Fallback to AeroDataBox time-window
      flights = await fetchIstFlightsFromAeroDataBox();
    }
    return flights;
  }

  let allFlights: Flight[] = await loadLiveFlights();
  if (!allFlights.length) {
    // Fallback to DB or static as last resort
    allFlights = (await fetchFlightsFromDb()).length ? await fetchFlightsFromDb() : staticFlights;
  }

  const result = filterFlights(allFlights, {
    type: merged.type,
    city: merged.city,
    flightNumber: merged.flightNumber,
  });

  if (result.length === 0) {
    return Response.json({
      answer: lang === "tr" ? "Uçuş bulunamadı." : "No matching flights found.",
      matches: [],
      gemini: geminiMeta ?? undefined,
      nluProvider,
    });
  }

  const lines = result.slice(0, 5).map((f) => {
    const cityText = f.direction === "Arrival" ? f.originCity : f.destinationCity;
    return `${cityText}: ${f.flightNumber} ${f.status}`;
  });
  const answer = lang === "tr"
    ? `Bulunan uçuşlar:\n${lines.join("\n")}`
    : `Matching flights:\n${lines.join("\n")}`;

  return Response.json({ answer, matches: result, gemini: geminiMeta ?? undefined, nluProvider });
}
