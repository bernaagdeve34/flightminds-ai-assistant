import type { Flight } from "@/lib/types";

// Adapter for AeroDataBox via RapidAPI
// This function is defensive: if env vars are missing or request fails, it returns an empty list.
export async function fetchIstFlightsFromAeroDataBox(): Promise<Flight[]> {
  const apiKey = process.env.AERODATABOX_API_KEY;
  const rapidHost = process.env.AERODATABOX_HOST || "aerodatabox.p.rapidapi.com";
  if (!apiKey) return [];

  // Use time-window endpoints (arrivals and departures separately).
  // Docs: AeroDataBox (RapidAPI): /flights/airports/icao/{icao}/{from}/{to}
  const airport = "LTFM"; // IST ICAO
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000); // -2h
  const to = new Date(now.getTime() + 10 * 60 * 60 * 1000); // +10h
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  const base = `https://${rapidHost}/flights/airports/icao/${airport}/${fmt(from)}/${fmt(to)}`;
  const urlArrivals = `${base}?withLeg=true&withCodeshared=true&withCancelled=true&withCargo=false&withPrivate=true&withLocation=false&direction=Arrival`;
  const urlDepartures = `${base}?withLeg=true&withCodeshared=true&withCancelled=true&withCargo=false&withPrivate=true&withLocation=false&direction=Departure`;

  const headers: HeadersInit = {
    "X-RapidAPI-Key": apiKey as string,
    "X-RapidAPI-Host": rapidHost,
  };

  async function safeFetch(url: string): Promise<any[]> {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error("AeroDataBox non-OK:", resp.status, await resp.text());
        return [];
      }
      const data = await resp.json();
      // Time-window returns { arrivals: [...] } or { departures: [...] } depending on direction param
      const list = (data?.arrivals || data?.departures || data?.flights || []) as any[];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error("AeroDataBox fetch error:", (e as Error)?.message || e);
      return [];
    }
  }

  const [arrRaw, depRaw] = await Promise.all([safeFetch(urlArrivals), safeFetch(urlDepartures)]);

  function mapStatus(s?: string): Flight["status"] {
    const v = (s || "").toLowerCase();
    if (v.includes("cancel")) return "Cancelled";
    if (v.includes("delay")) return "Delayed";
    if (v.includes("board")) return "Boarding";
    if (v.includes("land")) return "Landed";
    return "On Time";
  }

  function mapArrival(r: any): Flight | null {
    const num = r?.number || r?.flight?.number;
    const airline = r?.airline?.name || r?.airline?.icao || "";
    const originCity = r?.departure?.airport?.municipalityName || r?.departure?.airport?.name || "";
    const sched = r?.arrival?.scheduledTimeLocal || r?.arrival?.scheduledTimeUtc;
    const est = r?.arrival?.estimatedTimeLocal || r?.arrival?.estimatedTimeUtc;
    if (!num || !sched) return null;
    return {
      id: `${num}-ARR`,
      airportCode: "IST",
      flightNumber: String(num),
      airline,
      direction: "Arrival",
      originCity,
      destinationCity: "Istanbul",
      scheduledTimeLocal: new Date(sched).toISOString(),
      estimatedTimeLocal: est ? new Date(est).toISOString() : undefined,
      status: mapStatus(r?.status),
    };
  }

  function mapDeparture(r: any): Flight | null {
    const num = r?.number || r?.flight?.number;
    const airline = r?.airline?.name || r?.airline?.icao || "";
    const destCity = r?.arrival?.airport?.municipalityName || r?.arrival?.airport?.name || "";
    const sched = r?.departure?.scheduledTimeLocal || r?.departure?.scheduledTimeUtc;
    const est = r?.departure?.estimatedTimeLocal || r?.departure?.estimatedTimeUtc;
    if (!num || !sched) return null;
    return {
      id: `${num}-DEP`,
      airportCode: "IST",
      flightNumber: String(num),
      airline,
      direction: "Departure",
      originCity: "Istanbul",
      destinationCity: destCity,
      scheduledTimeLocal: new Date(sched).toISOString(),
      estimatedTimeLocal: est ? new Date(est).toISOString() : undefined,
      status: mapStatus(r?.status),
    };
  }

  const arrivals = arrRaw.map(mapArrival).filter(Boolean) as Flight[];
  const departures = depRaw.map(mapDeparture).filter(Boolean) as Flight[];

  // Merge unique by flightNumber + direction
  const uniq = new Map<string, Flight>();
  for (const f of [...arrivals, ...departures]) {
    uniq.set(`${f.flightNumber}-${f.direction}`, f);
  }

  return Array.from(uniq.values());
}
