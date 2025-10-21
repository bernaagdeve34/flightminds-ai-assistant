import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORIGIN = "https://www.istairport.com/umbraco/api/FlightInfo/GetFlightStatusBoard";

export async function GET(req: NextRequest) {
  try {
    const srcUrl = new URL(req.url);
    const forwardUrl = new URL(ORIGIN);
    // clone query params
    srcUrl.searchParams.forEach((v, k) => forwardUrl.searchParams.set(k, v));

    const resp = await fetch(forwardUrl.toString(), {
      headers: {
        // Some endpoints check UA; use a generic browser UA
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.istairport.com/",
      },
      // avoid Next fetch cache for dynamic
      cache: "no-store",
    });
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* some endpoints return text */ }

    if (!resp.ok) {
      return Response.json({ ok: false, status: resp.status, body: json ?? text }, { status: 200 });
    }

    const data = json ?? text;
    return Response.json({ ok: true, data });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const srcUrl = new URL(req.url);
    const forwardUrl = new URL(ORIGIN);
    srcUrl.searchParams.forEach((v, k) => forwardUrl.searchParams.set(k, v));
    const body = await req.text();
    const resp = await fetch(forwardUrl.toString(), {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": req.headers.get("content-type") || "application/json",
        "Referer": "https://www.istairport.com/",
      },
      body: body || undefined,
      cache: "no-store",
    });
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!resp.ok) {
      return Response.json({ ok: false, status: resp.status, body: json ?? text }, { status: 200 });
    }
    const data = json ?? text;
    return Response.json({ ok: true, data });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
