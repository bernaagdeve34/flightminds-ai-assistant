import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const audioBase64: string | undefined = body?.audioBase64;
    const mimeType: string = body?.mimeType || "audio/webm";
    const lang: "tr" | "en" = body?.lang === "en" ? "en" : "tr";
    const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY?.trim();
    const AZURE_OPENAI_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, "");
    const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION?.trim() || "2024-02-15-preview";
    const AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT = process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT?.trim() || "gpt-4o-mini-transcribe";

    if (!audioBase64) {
      return new Response(JSON.stringify({ error: "audioBase64 required" }), { status: 400 });
    }
    if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
      return new Response(JSON.stringify({ ok: false, error: "AZURE_OPENAI credentials missing" }), { status: 500 });
    }

    const binary = Buffer.from(audioBase64, "base64");

    // Prepare multipart form-data for Azure OpenAI audio transcription
    const form = new FormData();
    // In Node 18+, Blob is available
    const blob = new Blob([binary], { type: mimeType });
    form.append("file", blob, "audio.webm");
    // model field is still required by the API surface; Azure routes by deployment
    form.append("model", AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT);
    // Optional language hint
    form.append("language", lang === "tr" ? "tr" : "en");

    async function transcribe(model: string) {
      const f = new FormData();
      f.append("file", blob, "audio.webm");
      f.append("model", model);
      f.append("language", lang === "tr" ? "tr" : "en");
      const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${model}/audio/transcriptions?api-version=${AZURE_OPENAI_API_VERSION}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "api-key": AZURE_OPENAI_API_KEY || "" },
        body: f as any,
      });
      return r;
    }

    // Try modern model first, then fallback to whisper-1
    let resp = await transcribe(AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT);
    if (!resp.ok) {
      const firstErr = await resp.text();
      const whisperDep = process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT?.trim() || "whisper-1";
      resp = await transcribe(whisperDep);
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
