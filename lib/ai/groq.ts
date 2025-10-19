export interface NluResult {
  city?: string;
  type?: "Arrival" | "Departure";
  flightNumber?: string;
}

export interface GroqMeta {
  ok: boolean;
  httpStatus?: number;
  errorText?: string;
  provider: "groq";
}

export async function extractQueryWithGroq(query: string): Promise<NluResult | null> {
  const enabled = String(process.env.GROQ_ENABLED || "true").toLowerCase() !== "false";
  const apiKey = process.env.GROQ_API_KEY;
  if (!enabled || !apiKey) return null;
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const system =
    "You are a flight assistant for Istanbul Airport (IST). Extract structured fields as JSON with keys: city, type (Arrival|Departure), flightNumber. If unknown, omit keys. Reply ONLY with minified JSON.";
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Query: ${query}` },
        ],
        temperature: 0.2,
        max_tokens: 128,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) return null;
    const jsonText = text.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonText) as NluResult;
  } catch {
    return null;
  }
}

export async function extractQueryWithGroqMeta(query: string): Promise<{ result: NluResult | null; meta: GroqMeta }>{
  const enabled = String(process.env.GROQ_ENABLED || "true").toLowerCase() !== "false";
  const apiKey = process.env.GROQ_API_KEY;
  if (!enabled) return { result: null, meta: { ok: false, provider: "groq", errorText: "Disabled by GROQ_ENABLED=false" } };
  if (!apiKey) return { result: null, meta: { ok: false, provider: "groq", errorText: "API key missing" } };
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const system =
    "You are a flight assistant for Istanbul Airport (IST). Extract structured fields as JSON with keys: city, type (Arrival|Departure), flightNumber. If unknown, omit keys. Reply ONLY with minified JSON.";
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Query: ${query}` },
        ],
        temperature: 0.2,
        max_tokens: 128,
      }),
    });
    if (!resp.ok) {
      return { result: null, meta: { ok: false, provider: "groq", httpStatus: resp.status, errorText: await resp.text() } };
    }
    const data = await resp.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) return { result: null, meta: { ok: false, provider: "groq", errorText: "Empty response" } };
    const jsonText = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonText) as NluResult;
    return { result: parsed, meta: { ok: true, provider: "groq" } };
  } catch (e) {
    return { result: null, meta: { ok: false, provider: "groq", errorText: (e as Error)?.message || String(e) } };
  }
}
