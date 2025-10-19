import { NextRequest } from "next/server";
import { fetchIstFlightsFromAviationstack } from "@/lib/api/providers/aviationstack";
import { fetchIstFlightsFromAeroDataBox } from "@/lib/api/providers/aerodatabox";
import { getCache, setCache } from "@/lib/runtimeCache";
import { readJson, writeJson } from "@/lib/diskCache";

interface ArrivalRow {
  date: string;
  scheduled: string;
  estimated?: string;
  airline: string;
  flightNumber: string;
  departureAirport: string;
  baggage?: string;
  status: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined; // YYYY-MM-DD
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const debug = url.searchParams.get("debug") === "1";

  let provider: "aviationstack" | "aerodatabox" = "aviationstack";
  const cacheKey = `arrivals:${date ?? "today"}`;
  const cached = getCache<{ rows: ArrivalRow[] }>(cacheKey, 15 * 60 * 1000);
  const disk = await readJson<{ rows: ArrivalRow[] }>(cacheKey, 30 * 60 * 1000);
  const cooldown = getCache<number>(`cooldown:${cacheKey}`, 10 * 60 * 1000);

  // 1) Cache-first
  let rows: ArrivalRow[] = [];
  if (cached?.data?.rows?.length) {
    rows = cached.data.rows;
  } else if (disk.data?.rows?.length) {
    rows = disk.data.rows;
  }

  // 2) If no cache and no cooldown, hit providers
  if (!rows.length && !cooldown) {
    const flights = await fetchIstFlightsFromAviationstack(date);
    rows = flights
      .filter((f) => f.direction === "Arrival")
      .map((f) => ({
        date: f.scheduledTimeLocal,
        scheduled: f.scheduledTimeLocal,
        estimated: f.estimatedTimeLocal,
        airline: f.airline,
        flightNumber: f.flightNumber,
        departureAirport: f.originCity,
        baggage: undefined, // aviationstack free plan often lacks baggage/terminal reliably
        status: f.status,
      }));
    if (!rows.length) {
      try {
        const adb = await fetchIstFlightsFromAeroDataBox();
        rows = adb
          .filter((f) => f.direction === "Arrival")
          .map((f) => ({
            date: f.scheduledTimeLocal,
            scheduled: f.scheduledTimeLocal,
            estimated: f.estimatedTimeLocal,
            airline: f.airline,
            flightNumber: f.flightNumber,
            departureAirport: f.originCity,
            baggage: undefined,
            status: f.status,
          }));
        if (rows.length) provider = "aerodatabox";
      } catch {}
    }
  }

  // If still empty, try cache
  let cacheUsed = false;
  if (!rows.length) {
    if (cached?.data?.rows?.length) {
      rows = cached.data.rows;
      cacheUsed = true;
    } else if (disk.data?.rows?.length) {
      rows = disk.data.rows;
      cacheUsed = true;
    }
  }

  const filtered = rows.filter((r) => {
    if (!q) return true;
    return (
      r.flightNumber.toLowerCase().includes(q) ||
      (r.departureAirport || "").toLowerCase().includes(q) ||
      (r.airline || "").toLowerCase().includes(q)
    );
  });

  const basePayload: any = {
    source: "aviationstack",
    provider,
    date: date || "today",
    q,
    total: filtered.length,
    arrivals: filtered,
    cache: { used: cacheUsed, ts: cached?.ts ?? null },
  };

  if (debug) {
    const key = process.env.AVIATIONSTACK_API_KEY || "";
    const host = process.env.AVIATIONSTACK_HOST || "api.aviationstack.com";
    const scheme = process.env.AVIATIONSTACK_SCHEME || "http";
    const base = `${scheme}://${host}/v1/flights`;
    async function raw(u: string) {
      try {
        const res = await fetch(u);
        const json = await res.json();
        const count = Array.isArray((json as any)?.data) ? (json as any).data.length : 0;
        const err = (json as any)?.error || undefined;
        return { url: u, status: res.status, count, error: err };
      } catch (e: any) {
        return { url: u, status: 0, count: 0, error: String(e) };
      }
    }
    const urls: string[] = [];
    if (date) urls.push(`${base}?access_key=${key}&arr_icao=LTFM&flight_date=${date}&limit=50`);
    if (date) urls.push(`${base}?access_key=${key}&arr_iata=IST&flight_date=${date}&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_icao=LTFM&flight_status=scheduled&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_iata=IST&flight_status=scheduled&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_icao=LTFM&flight_status=active&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_iata=IST&flight_status=active&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_icao=LTFM&flight_status=landed&limit=50`);
    urls.push(`${base}?access_key=${key}&arr_iata=IST&flight_status=landed&limit=50`);
    const probes = await Promise.all(urls.map((u) => raw(u)));
    basePayload.debug = { probes };
  }

  // Save cache on success (non-empty and not from cache)
  if (filtered.length && !cacheUsed) {
    setCache(cacheKey, { rows: filtered });
    await writeJson(cacheKey, { rows: filtered });
  } else if (!filtered.length) {
    // Set cooldown to avoid hammering providers repeatedly when empty
    setCache(`cooldown:${cacheKey}`, Date.now());
  }
  return Response.json(basePayload);
}
