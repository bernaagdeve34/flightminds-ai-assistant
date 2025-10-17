import { NextRequest } from "next/server";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import { flights as staticFlights } from "@/lib/data/flights";

export async function GET(_req: NextRequest) {
	try {
		const dbFlights = await fetchFlightsFromDb();
		if (dbFlights.length > 0) return Response.json({ flights: dbFlights, source: "db" });
		return Response.json({ flights: staticFlights, source: "static" });
	} catch (e) {
		return Response.json({ flights: staticFlights, source: "static", error: String(e) });
	}
}


