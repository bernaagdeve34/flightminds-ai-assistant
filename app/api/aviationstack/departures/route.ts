import { NextRequest } from "next/server";
import { fetchIstFlightsFromAviationstack } from "@/lib/api/providers/aviationstack";
import { fetchIstFlightsFromAeroDataBox } from "@/lib/api/providers/aerodatabox";
import { getCache, setCache } from "@/lib/runtimeCache";
import { readJson, writeJson } from "@/lib/diskCache";

interface DepartureRow {
  date: string;
  scheduled: string;
  estimated?: string;
  airline: string;
  flightNumber: string;
  destinationAirport: string;
  baggage?: string;
  status: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined; // YYYY-MM-DD
  const q = (url.searchParams.get("q") || "").toLowerCase();

  const flights = await fetchIstFlightsFromAviationstack(date);
  let provider: "aviationstack" | "aerodatabox" = "aviationstack";
  const cacheKey = `departures:${date ?? "today"}`;
  const cached = getCache<{ rows: DepartureRow[] }>(cacheKey, 15 * 60 * 1000);
  const disk = await readJson<{ rows: DepartureRow[] }>(cacheKey, 30 * 60 * 1000);
  let rows: DepartureRow[] = flights
    .filter((f) => f.direction === "Departure")
    .map((f) => ({
      date: f.scheduledTimeLocal,
      scheduled: f.scheduledTimeLocal,
      estimated: f.estimatedTimeLocal,
      airline: f.airline,
      flightNumber: f.flightNumber,
      destinationAirport: f.destinationCity,
      baggage: undefined,
      status: f.status,
    }));

  if (!rows.length) {
    try {
      const adb = await fetchIstFlightsFromAeroDataBox();
      rows = adb
        .filter((f) => f.direction === "Departure")
        .map((f) => ({
          date: f.scheduledTimeLocal,
          scheduled: f.scheduledTimeLocal,
          estimated: f.estimatedTimeLocal,
          airline: f.airline,
          flightNumber: f.flightNumber,
          destinationAirport: f.destinationCity,
          baggage: undefined,
          status: f.status,
        }));
      if (rows.length) provider = "aerodatabox";
    } catch {}
  }

  let cacheUsed = false;
  if (!rows.length && cached?.data?.rows?.length) {
    rows = cached.data.rows;
    cacheUsed = true;
  }
  if (!rows.length && disk.data?.rows?.length) {
    rows = disk.data.rows;
    cacheUsed = true;
  }

  const filtered = rows.filter((r) => {
    if (!q) return true;
    return (
      r.flightNumber.toLowerCase().includes(q) ||
      (r.destinationAirport || "").toLowerCase().includes(q) ||
      (r.airline || "").toLowerCase().includes(q)
    );
  });

  const payload = {
    source: "aviationstack",
    provider,
    date: date || "today",
    q,
    total: filtered.length,
    departures: filtered,
    cache: { used: cacheUsed, ts: cached?.ts ?? null },
  };
  if (filtered.length && !cacheUsed) {
    setCache(cacheKey, { rows: filtered });
    await writeJson(cacheKey, { rows: filtered });
  }
  return Response.json(payload);
}
