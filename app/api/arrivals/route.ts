import { NextRequest } from "next/server";
import { fetchArrivalsFullDay } from "@/lib/api/providers/aerodatabox-arrivals";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined; // YYYY-MM-DD
  const q = (url.searchParams.get("q") || "").toLowerCase();

  const rows = await fetchArrivalsFullDay(date);

  // Optional filter
  const filtered = rows.filter((r) => {
    if (!q) return true;
    return (
      r.flightNumber.toLowerCase().includes(q) ||
      (r.departureAirport || "").toLowerCase().includes(q) ||
      (r.airline || "").toLowerCase().includes(q)
    );
  });

  return Response.json({ source: "aerodatabox", date: date || "today", arrivals: filtered });
}
