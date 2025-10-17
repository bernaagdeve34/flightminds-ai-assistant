export interface NluResult {
	city?: string;
	type?: "Arrival" | "Departure";
	flightNumber?: string;
}

export async function extractQueryWithGemini(query: string): Promise<NluResult | null> {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;

	// Minimal JSON-extraction prompt for Gemini 1.5 via REST
	const system =
		"You are a flight assistant for Istanbul Airport (IST). Extract structured fields as JSON with keys: city, type (Arrival|Departure), flightNumber. If unknown, omit keys. Reply ONLY with minified JSON.";
	const user = `Query: ${query}`;

	try {
		const resp = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [
						{ role: "user", parts: [{ text: system }] },
						{ role: "user", parts: [{ text: user }] },
					],
					generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
				}),
			}
		);
		if (!resp.ok) return null;
		const data = await resp.json();
		const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
		if (!text) return null;
		const jsonText = text.replace(/```json|```/g, "").trim();
		const parsed = JSON.parse(jsonText);
		return parsed as NluResult;
	} catch {
		return null;
	}
}


