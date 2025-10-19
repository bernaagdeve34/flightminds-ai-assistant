import { NextRequest } from "next/server";

export async function GET(_req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  const enabled = String(process.env.GEMINI_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return Response.json({ ok: false, error: "GEMINI_ENABLED=false" }, { status: 400 });
  if (!key) return Response.json({ ok: false, error: "GEMINI_API_KEY missing" }, { status: 400 });

  async function list(ver: string) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${key}`);
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      return { version: ver, status: res.status, body: json ?? text };
    } catch (e: any) {
      return { version: ver, status: 0, body: String(e?.message || e) };
    }
  }

  const [v1, v1beta] = await Promise.all([list("v1"), list("v1beta")]);
  return Response.json({ ok: true, results: [v1, v1beta] });
}
