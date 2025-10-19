export interface NluResult {
	city?: string;
	type?: "Arrival" | "Departure";
	flightNumber?: string;
}

export interface GeminiMeta {
    ok: boolean;
    httpStatus?: number;
    errorText?: string;
}

const MODEL_CANDIDATES = [
    process.env.GEMINI_MODEL,
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash-8b",
].filter(Boolean) as string[];

const VERSION_CANDIDATES = ["v1", "v1beta"] as const;

async function tryGemini(apiKey: string, model: string, version: string, system: string, user: string): Promise<{ ok: boolean; result: NluResult | null; status?: number; text?: string }>{
    try {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    { role: "user", parts: [{ text: system }] },
                    { role: "user", parts: [{ text: user }] },
                ],
                generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
            }),
        });
        if (!resp.ok) {
            return { ok: false, result: null, status: resp.status, text: await resp.text() };
        }
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
        if (!text) return { ok: false, result: null, status: 200, text: "Empty response" };
        const jsonText = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(jsonText) as NluResult;
        return { ok: true, result: parsed };
    } catch (e) {
        return { ok: false, result: null, text: (e as Error)?.message || String(e) };
    }
}

function defaultSystemPrompt(): string {
    return "You are a flight assistant for Istanbul Airport (IST). Extract structured fields as JSON with keys: city, type (Arrival|Departure), flightNumber. If unknown, omit keys. Reply ONLY with minified JSON.";
}

export async function extractQueryWithGemini(query: string): Promise<NluResult | null> {
    const enabled = String(process.env.GEMINI_ENABLED || "true").toLowerCase() !== "false";
    if (!enabled) return null;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log("[Gemini] API key missing; skipping NLU");
        return null;
    }
    const system = defaultSystemPrompt();
    const user = `Query: ${query}`;
    for (const ver of VERSION_CANDIDATES) {
        for (const model of MODEL_CANDIDATES) {
            const r = await tryGemini(apiKey, model, ver, system, user);
            if (r.ok && r.result) {
                return r.result;
            }
        }
    }
    return null;
}

export async function extractQueryWithGeminiMeta(query: string): Promise<{ result: NluResult | null; meta: GeminiMeta }>{
    const enabled = String(process.env.GEMINI_ENABLED || "true").toLowerCase() !== "false";
    if (!enabled) {
        return { result: null, meta: { ok: false, errorText: "Disabled by GEMINI_ENABLED=false" } };
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { result: null, meta: { ok: false, errorText: "API key missing" } };
    }
    const system = defaultSystemPrompt();
    const user = `Query: ${query}`;
    let lastStatus: number | undefined;
    let lastText: string | undefined;
    for (const ver of VERSION_CANDIDATES) {
        for (const model of MODEL_CANDIDATES) {
            const r = await tryGemini(apiKey, model, ver, system, user);
            if (r.ok) {
                return { result: r.result, meta: { ok: true } };
            }
            lastStatus = r.status;
            lastText = r.text;
        }
    }
    return { result: null, meta: { ok: false, httpStatus: lastStatus, errorText: lastText } };
}
