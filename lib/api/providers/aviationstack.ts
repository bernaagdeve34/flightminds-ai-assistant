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
  const urlsDep: string[] = [
    `${base}?${new URLSearchParams({ access_key: key, dep_icao: "LTFM", flight_date, limit: "100" }).toString()}`,
    `${base}?${new URLSearchParams({ access_key: key, dep_iata: "IST",  flight_date, limit: "100" }).toString()}`,
  ];
  const urlsArr: string[] = [
    `${base}?${new URLSearchParams({ access_key: key, arr_icao: "LTFM", flight_date, limit: "100" }).toString()}`,
    `${base}?${new URLSearchParams({ access_key: key, arr_iata: "IST",  flight_date, limit: "100" }).toString()}`,
  ];

  async function safe(url: string): Promise<any[]> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      const res = await fetch(url, { signal: ac.signal }).catch((e) => {
        return new Response(null, { status: 599, statusText: String(e) }) as any;
      });
      clearTimeout(t);
      if (!res.ok) {
        console.log("[Aviationstack] non-OK", res.status, url);
        return [];
      }
      const json = await res.json();
      const data = (json?.data ?? []) as any[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  // Query ICAO and IATA in parallel and take the first non-empty
  let depRaw: any[] = [];
  let arrRaw: any[] = [];
  {
    const [d1, d2] = await Promise.all([safe(urlsDep[0]), safe(urlsDep[1])]);
    depRaw = d1.length ? d1 : d2;
    const [a1, a2] = await Promise.all([safe(urlsArr[0]), safe(urlsArr[1])]);
    arrRaw = a1.length ? a1 : a2;
  }

  // Fallback: try without date (live) and status variants if still empty
  if (arrRaw.length === 0 || depRaw.length === 0) {
    const status = "active";
    const a1 = `${base}?${new URLSearchParams({ access_key: key, arr_icao: "LTFM", flight_status: status, limit: "100" }).toString()}`;
    const a2 = `${base}?${new URLSearchParams({ access_key: key, arr_iata: "IST",  flight_status: status, limit: "100" }).toString()}`;
    const d1 = `${base}?${new URLSearchParams({ access_key: key, dep_icao: "LTFM", flight_status: status, limit: "100" }).toString()}`;
    const d2 = `${base}?${new URLSearchParams({ access_key: key, dep_iata: "IST",  flight_status: status, limit: "100" }).toString()}`;
    const [ar1, ar2, dr1, dr2] = await Promise.all([safe(a1), safe(a2), safe(d1), safe(d2)]);
    if (!arrRaw.length) arrRaw = ar1.length ? ar1 : ar2;
    if (!depRaw.length) depRaw = dr1.length ? dr1 : dr2;
  }

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
