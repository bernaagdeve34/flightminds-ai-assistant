export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    ...init,
  });
}

export async function POST() {
  try {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim() || "westeurope";
    if (!key) {
      return json({ ok: false, error: "AZURE_SPEECH_KEY is missing" });
    }

    const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Length": "0",
      },
      cache: "no-store",
    });

    const token = await resp.text();
    if (!resp.ok || !token) {
      return json({ ok: false, status: resp.status, body: token || null });
    }

    // Azure token typically valid for ~10 minutes
    return json({ ok: true, token, region, expiresInSeconds: 600 });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) });
  }
}
