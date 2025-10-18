import { NextRequest } from "next/server";
import { getRecentFlights, saveFlightsSnapshot, fetchFlightsFromDb } from "@/lib/db/flights";
import { flights as staticFlights } from "@/lib/data/flights";
import { fetchIstFlightsFromAeroDataBox } from "@/lib/api/providers/aerodatabox";
import { fetchIstFlightsFromAviationstack } from "@/lib/api/providers/aviationstack";

export async function GET(req: NextRequest) {
    const ttlMin = Number(process.env.FLIGHTS_CACHE_TTL_MIN ?? 5);
    try {
        const url = new URL(req.url);
        const forceLive = url.searchParams.get("source") === "live" || url.searchParams.get("force") === "provider";
        const dateParam = url.searchParams.get("date"); // YYYY-MM-DD (local)

        function isoDayRange(yyyyMmDd: string): { start: string; end: string } {
            // Interpret date as local day bounds, convert to ISO UTC strings
            const [y, m, d] = yyyyMmDd.split("-").map((v) => Number(v));
            const startLocal = new Date(y, (m - 1), d, 0, 0, 0, 0);
            const endLocal = new Date(y, (m - 1), d + 1, 0, 0, 0, 0);
            return { start: startLocal.toISOString(), end: endLocal.toISOString() };
        }

        const todayLocal = new Date();
        const yyyy = todayLocal.getFullYear();
        const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
        const dd = String(todayLocal.getDate()).padStart(2, "0");
        const targetDate = dateParam ?? `${yyyy}-${mm}-${dd}`;
        const dayRange = isoDayRange(targetDate);

        const filterByDate = (arr: any[]) =>
            arr.filter((f) => {
                const t = f?.scheduledTimeLocal as string;
                return t >= dayRange.start && t < dayRange.end;
            });

        function normalizeFlight(f: any): any {
            const stored = String(f?.status || "");
            const schedStr = f?.scheduledTimeLocal;
            const estStr = f?.estimatedTimeLocal;
            const schedMs = schedStr ? new Date(schedStr).getTime() : undefined;
            const estMs = estStr ? new Date(estStr).getTime() : undefined;

            // Always compute status dynamically (except explicit Cancelled)
            if (stored === "Cancelled") {
                return { ...f, status: "Cancelled", estimatedTimeLocal: estStr ?? schedStr };
            }

            // If no estimate, show scheduled in estimated column and mark On_Time
            if (!estMs || !schedMs) {
                return { ...f, status: "On_Time", estimatedTimeLocal: schedStr };
            }

            // Delay rule: strictly future compared to scheduled
            const status = estMs > schedMs ? "Delayed" : "On_Time";
            return { ...f, status };
        }

        const shape = (arr: any[]) => arr.map(normalizeFlight);

        const dbOnly = String(process.env.USE_DB_ONLY || "").toLowerCase() === "true";
        if (!dbOnly && forceLive && !dateParam) {
            const provider = String(process.env.PROVIDER || "").toLowerCase();
            let live: any[] = [];
            if (provider === "aviationstack" && process.env.AVIATIONSTACK_API_KEY) {
                live = await fetchIstFlightsFromAviationstack(targetDate);
            } else {
                live = await fetchIstFlightsFromAeroDataBox();
            }
            if (live.length > 0) {
                const src = provider === "aviationstack" ? "provider:aviationstack" : "provider:aerodatabox";
                await saveFlightsSnapshot(live, src);
                return Response.json({ flights: shape(filterByDate(live)), source: src, forced: true, date: targetDate });
            }
            // fall through to normal flow if provider returned empty
        }

        // If a specific date is requested (not today), prefer DB only.
        const isToday = !dateParam;
        if (!dbOnly && isToday) {
            // 1) Recent DB cache (only for today)
            const cached = await getRecentFlights(ttlMin, "IST");
            if (cached.length > 0) {
                return Response.json({ flights: shape(filterByDate(cached)), source: "db_cache", date: targetDate });
            }
        }

        // 2) Try live provider (AeroDataBox)
        if (isToday) {
            let live: any[] = [];
            const provider = String(process.env.PROVIDER || "").toLowerCase();
            if (provider === "aviationstack" && process.env.AVIATIONSTACK_API_KEY) {
                live = await fetchIstFlightsFromAviationstack(targetDate);
            } else {
                live = await fetchIstFlightsFromAeroDataBox();
            }
            if (live.length > 0) {
                const src = provider === "aviationstack" ? "provider:aviationstack" : "provider:aerodatabox";
                await saveFlightsSnapshot(live, src);
                return Response.json({ flights: shape(filterByDate(live)), source: src, date: targetDate });
            }
        }

        // 3) Fallback: whatever is in DB (older than TTL) or static
        const dbFlights = await fetchFlightsFromDb();
        if (dbFlights.length > 0) return Response.json({ flights: shape(filterByDate(dbFlights)), source: "db", date: targetDate });
        return Response.json({ flights: shape(filterByDate(staticFlights)), source: "static", date: targetDate });
    } catch (e) {
        return Response.json({ flights: staticFlights, source: "static", error: String(e) });
    }
}
