import type { NextRequest } from "next/server";

export interface ArrivalRow {
  date: string; // ISO string local
  scheduled: string; // ISO string local
  estimated?: string; // ISO string local
  airline: string;
  flightNumber: string;
  departureAirport: string;
  baggage?: string;
  status: string; // On time / Delayed / Landed / Cancelled
}

function parseYmd(yyyyMmDd?: string): [number, number, number] {
  const now = new Date();
  const ymd = yyyyMmDd ?? `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

function toIsoMinuteZ(dt: Date) {
  // Format minutes precision with trailing 'Z'
  return dt.toISOString().slice(0,16) + "Z";
}

function dayWindowsUtcIso(yyyyMmDd?: string) {
  // Returns two windows within 12h each in UTC ISO minute format
  const [y, m, d] = parseYmd(yyyyMmDd);
  const s1 = new Date(y, (m-1), d, 0, 0, 0, 0);   // 00:00 local
  const e1 = new Date(y, (m-1), d, 11, 59, 0, 0); // 11:59 local
  const s2 = new Date(y, (m-1), d, 12, 0, 0, 0);  // 12:00 local
  const e2 = new Date(y, (m-1), d, 23, 59, 0, 0); // 23:59 local
  return [
    { startIso: toIsoMinuteZ(s1), endIso: toIsoMinuteZ(e1) },
    { startIso: toIsoMinuteZ(s2), endIso: toIsoMinuteZ(e2) },
  ];
}

function mapStatus(s?: string): string {
  const v = (s||"").toLowerCase();
  if (v.includes("cancel")) return "Cancelled";
  if (v.includes("delay")) return "Delayed";
  if (v.includes("land")) return "Landed";
  if (v.includes("early")) return "Early"; // not always provided
  return "On Time";
}

export async function fetchArrivalsFullDay(dateParam?: string): Promise<ArrivalRow[]> {
  const apiKey = process.env.AERODATABOX_API_KEY;
  const rapidHost = process.env.AERODATABOX_HOST || "aerodatabox.p.rapidapi.com";
  if (!apiKey) return [];

  const windows = dayWindowsUtcIso(dateParam);

  const headers: HeadersInit = {
    "X-RapidAPI-Key": apiKey as string,
    "X-RapidAPI-Host": rapidHost,
  };

  try {
    const all: ArrivalRow[] = [];
    for (const w of windows) {
      const url = `https://${rapidHost}/flights/airports/icao/LTFM/${w.startIso}/${w.endIso}?withLeg=true&withCodeshared=true&withCancelled=true&withCargo=false&withPrivate=true&withLocation=false&direction=Arrival`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error("[AeroDataBox] non-OK", resp.status, "window:", w.startIso, "->", w.endIso);
        const text = await resp.text().catch(() => "");
        if (text) console.error("[AeroDataBox] body:", text.slice(0, 500));
        continue;
      }
      const data = await resp.json();
      const list: any[] = data?.arrivals || data?.flights || [];
      const rows: ArrivalRow[] = list.map((r: any) => {
        const scheduled = r?.arrival?.scheduledTimeLocal || r?.arrival?.scheduledTimeUtc;
        const estimated = r?.arrival?.estimatedTimeLocal || r?.arrival?.estimatedTimeUtc;
        const airline = r?.airline?.name || r?.airline?.icao || "";
        const number = r?.number || r?.flight?.number || "";
        const departureAirport = r?.departure?.airport?.name || r?.departure?.airport?.municipalityName || "";
        const baggage = r?.arrival?.baggageBelt || r?.arrival?.terminal || undefined;
        return {
          date: scheduled ? new Date(scheduled).toISOString() : new Date().toISOString(),
          scheduled: scheduled ? new Date(scheduled).toISOString() : "",
          estimated: estimated ? new Date(estimated).toISOString() : undefined,
          airline,
          flightNumber: String(number),
          departureAirport,
          baggage: baggage ? String(baggage) : undefined,
          status: mapStatus(r?.status),
        };
      }).filter((r: ArrivalRow) => !!r.scheduled && !!r.flightNumber);
      all.push(...rows);
    }
    return all;
  } catch (e) {
    console.error("[AeroDataBox] fetch error:", (e as Error)?.message || e, "windows:", windows);
    return [];
  }
}
