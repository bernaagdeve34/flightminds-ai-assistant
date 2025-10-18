import type { Flight } from "@/lib/types";

// Adapter for Aviationstack API
// Docs: https://aviationstack.com/documentation
// Free plan may be delayed data; we normalize to our Flight type.
export async function fetchIstFlightsFromAviationstack(targetDate?: string): Promise<Flight[]> {
  const key = process.env.AVIATIONSTACK_API_KEY;
  const host = process.env.AVIATIONSTACK_HOST || "api.aviationstack.com";
  const scheme = process.env.AVIATIONSTACK_SCHEME || "http"; // free plan typically requires http
  if (!key) return [];

  // Determine date (UTC date string YYYY-MM-DD). If missing, use today local.
  const todayLocal = new Date();
  const yyyy = todayLocal.getFullYear();
  const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
  const dd = String(todayLocal.getDate()).padStart(2, "0");
  const flight_date = targetDate ?? `${yyyy}-${mm}-${dd}`;

  const base = `${scheme}://${host}/v1/flights`;
  const qsDep = new URLSearchParams({ access_key: key, dep_icao: "LTFM", flight_date, limit: "100" });
  const qsArr = new URLSearchParams({ access_key: key, arr_icao: "LTFM", flight_date, limit: "100" });
  const urlDep = `${base}?${qsDep.toString()}`;
  const urlArr = `${base}?${qsArr.toString()}`;

  async function safe(url: string): Promise<any[]> {
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      const data = (json?.data ?? []) as any[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  const [depRaw, arrRaw] = await Promise.all([safe(urlDep), safe(urlArr)]);

  function toIso(x?: string | null): string | undefined {
    if (!x) return undefined;
    const d = new Date(x);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  function mapStatus(s?: string | null): Flight["status"] {
    const v = (s || "").toLowerCase();
    if (v.includes("cancel")) return "Cancelled" as Flight["status"];
    if (v.includes("delay")) return "Delayed" as Flight["status"];
    // aviationstack uses: scheduled, active, landed, cancelled, incident, diverted
    // We'll normalize later by time diff; treat others as On Time baseline
    return "On Time" as Flight["status"];
  }

  const dep: Flight[] = depRaw.map((r) => {
    const airline = r?.airline?.name || r?.airline?.name || "";
    const fn = r?.flight?.iata || r?.flight?.icao || r?.flight?.number || "";
    const destCity = r?.arrival?.airport || r?.arrival?.iata || r?.arrival?.icao || "";
    const sched = toIso(r?.departure?.scheduled);
    const est = toIso(r?.departure?.estimated);
    if (!fn || !sched) return null as any;
    return {
      id: `${String(fn)}-dep-${sched}`,
      airportCode: "IST",
      flightNumber: String(fn),
      airline,
      direction: "Departure",
      originCity: "Istanbul",
      destinationCity: String(destCity),
      scheduledTimeLocal: sched!,
      estimatedTimeLocal: est,
      status: mapStatus(r?.flight_status),
      source: "provider:aviationstack",
      fetchedAt: new Date().toISOString() as any,
      createdAt: new Date().toISOString() as any,
      updatedAt: new Date().toISOString() as any,
    } as Flight;
  }).filter(Boolean);

  const arr: Flight[] = arrRaw.map((r) => {
    const airline = r?.airline?.name || "";
    const fn = r?.flight?.iata || r?.flight?.icao || r?.flight?.number || "";
    const origCity = r?.departure?.airport || r?.departure?.iata || r?.departure?.icao || "";
    const sched = toIso(r?.arrival?.scheduled);
    const est = toIso(r?.arrival?.estimated);
    if (!fn || !sched) return null as any;
    return {
      id: `${String(fn)}-arr-${sched}`,
      airportCode: "IST",
      flightNumber: String(fn),
      airline,
      direction: "Arrival",
      originCity: String(origCity),
      destinationCity: "Istanbul",
      scheduledTimeLocal: sched!,
      estimatedTimeLocal: est,
      status: mapStatus(r?.flight_status),
      source: "provider:aviationstack",
      fetchedAt: new Date().toISOString() as any,
      createdAt: new Date().toISOString() as any,
      updatedAt: new Date().toISOString() as any,
    } as Flight;
  }).filter(Boolean);

  // Uniq by flightNumber+direction
  const uniq = new Map<string, Flight>();
  for (const f of [...dep, ...arr]) {
    uniq.set(`${f.flightNumber}-${f.direction}`, f);
  }
  return Array.from(uniq.values());
}
