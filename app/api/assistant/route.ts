import { NextRequest } from "next/server";
import { flights as staticFlights } from "@/lib/data/flights";
import { filterFlights } from "@/lib/utils";
import { fetchFlightsFromDb } from "@/lib/db/flights";
import { extractQueryWithGemini } from "@/lib/ai/gemini";

export async function POST(req: NextRequest) {
	const body = await req.json().catch(() => null);
	const query: string = body?.query ?? "";
	const lang: "tr" | "en" = body?.lang === "en" ? "en" : "tr";

	// 1) Try Gemini parsing
	const nlu = await extractQueryWithGemini(query);
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

    const allFlights = (await fetchFlightsFromDb()).length
        ? await fetchFlightsFromDb()
        : staticFlights;

    const result = filterFlights(allFlights, {
		type: merged.type,
		city: merged.city,
		flightNumber: merged.flightNumber,
	});

	if (result.length === 0) {
		return Response.json({
			answer: lang === "tr" ? "Uçuş bulunamadı." : "No matching flights found.",
			matches: [],
		});
	}

	const lines = result.slice(0, 5).map((f) => {
		const cityText = f.direction === "Arrival" ? f.originCity : f.destinationCity;
		return `${cityText}: ${f.flightNumber} ${f.status}`;
	});
	const answer = lang === "tr"
		? `Bulunan uçuşlar:\n${lines.join("\n")}`
		: `Matching flights:\n${lines.join("\n")}`;

	return Response.json({ answer, matches: result });
}


