import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const audioBase64: string | undefined = body?.audioBase64;
    const mimeType: string = body?.mimeType || "audio/webm";
    const lang: "tr" | "en" = body?.lang === "en" ? "en" : "tr";

    if (!audioBase64) {
      return new Response(JSON.stringify({ error: "audioBase64 required" }), { status: 400 });
    }
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY missing" }), { status: 500 });
    }

    const binary = Buffer.from(audioBase64, "base64");

    // Prepare multipart form-data for OpenAI whisper-1
    const form = new FormData();
    // In Node 18+, Blob is available
    const blob = new Blob([binary], { type: mimeType });
    form.append("file", blob, "audio.webm");
    form.append("model", "whisper-1");
    // Optional language hint
    form.append("language", lang === "tr" ? "tr" : "en");

    async function transcribe(model: string) {
      const f = new FormData();
      f.append("file", blob, "audio.webm");
      f.append("model", model);
      f.append("language", lang === "tr" ? "tr" : "en");
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: f as any,
      });
      return r;
    }

    // Try modern model first, then fallback to whisper-1
    let resp = await transcribe("gpt-4o-mini-transcribe");
    if (!resp.ok) {
      const firstErr = await resp.text();
      resp = await transcribe("whisper-1");
      if (!resp.ok) {
        const secondErr = await resp.text();
        return new Response(
          JSON.stringify({ ok: false, error: "openai_error", details: { first: firstErr, second: secondErr } }),
          { status: 502 }
        );
      }
    }
    const data: any = await resp.json();
    const transcript: string = String(data?.text ?? "");

    return Response.json({ ok: true, transcript });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: "stt_failed", details: String(e?.message || e) }), { status: 500 });
  }
}
