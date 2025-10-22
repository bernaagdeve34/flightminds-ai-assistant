/* Simple Express API for flights with backend status calculation.
   Endpoints:
     - GET /departures?date=YYYY-MM-DD
     - GET /arrivals?date=YYYY-MM-DD
   Run:
     npm i express cors
     node server/express-flight-api.cjs
*/
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
// Accept raw x-www-form-urlencoded bodies for proxying without mutation
app.use(express.text({ type: 'application/x-www-form-urlencoded' }));

function toISO(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

function parseDateParam(str) {
  if (!str) {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
}

function buildMockFlights(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // A few departures and arrivals around the day to exercise all statuses
  const flights = [
    // Departures
    { dir: 'Departure', flightNumber: 'TK1901', scheduled: toISO(y, m, d, 8, 30), estimated: toISO(y, m, d, 8, 29) }, // Zamanında (<5)
    { dir: 'Departure', flightNumber: 'PC2101', scheduled: toISO(y, m, d, 9, 15), estimated: toISO(y, m, d, 9, 35) }, // Gecikmeli (20)
    { dir: 'Departure', flightNumber: 'XQ123',  scheduled: toISO(y, m, d, 10, 0), estimated: toISO(y, m, d, 10, 45) }, // Uzun Gecikmeli (45)
    { dir: 'Departure', flightNumber: 'TK999',  scheduled: toISO(y, m, d, 11, 20), estimated: null },                 // Bilinmiyor
    { dir: 'Departure', flightNumber: 'W6512', scheduled: toISO(y, m, d, 12, 0),  estimated: toISO(y, m, d, 12, 0), landed: false, cancelled: true }, // İptal

    // Arrivals
    { dir: 'Arrival', flightNumber: 'LH170', scheduled: toISO(y, m, d, 13, 35), estimated: toISO(y, m, d, 13, 30) }, // Zamanında
    { dir: 'Arrival', flightNumber: 'LY604', scheduled: toISO(y, m, d, 14, 10), estimated: toISO(y, m, d, 14, 35) }, // Gecikmeli
    { dir: 'Arrival', flightNumber: 'W6420', scheduled: toISO(y, m, d, 15, 0),  estimated: toISO(y, m, d, 15, 40) }, // Uzun Gecikmeli
    { dir: 'Arrival', flightNumber: 'TK501', scheduled: toISO(y, m, d, 16, 20), estimated: null },                  // Bilinmiyor
    { dir: 'Arrival', flightNumber: 'PC350', scheduled: toISO(y, m, d, 17, 0),  estimated: toISO(y, m, d, 17, 0), landed: true }, // İndi
  ];
  return flights;
}

function diffMinutes(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.round((b - a) / 60000);
}

function computeStatusAndEstimatedOut(f) {
  // Hard states first
  if (f.cancelled) return { status: 'İptal', estimatedOut: null };
  // 'İndi' durumu kullanılmayacak.

  // Eğer tahmini saat yoksa, gerçek hayattaki tablolarda genelde '-' gösterilir ve durum 'Zamanında' varsayılır.
  if (!f.estimated) return { status: 'Zamanında', estimatedOut: null };

  const delta = Math.abs(diffMinutes(f.scheduled, f.estimated));
  if (delta <= 5) return { status: 'Zamanında', estimatedOut: f.estimated };
  if (delta <= 30) return { status: 'Gecikmeli', estimatedOut: f.estimated };
  return { status: 'Uzun Gecikmeli', estimatedOut: f.estimated };
}

function mapOut(f) {
  const { status, estimatedOut } = computeStatusAndEstimatedOut(f);
  return {
    flightNumber: f.flightNumber,
    scheduled: f.scheduled,
    estimated: estimatedOut,
    status,
  };
}

app.get('/departures', (req, res) => {
  const date = parseDateParam(req.query.date);
  const flights = buildMockFlights(date).filter(f => f.dir === 'Departure').map(mapOut);
  res.json({ date, flights });
});

app.get('/arrivals', (req, res) => {
  const date = parseDateParam(req.query.date);
  const flights = buildMockFlights(date).filter(f => f.dir === 'Arrival').map(mapOut);
  res.json({ date, flights });
});

// Live proxy to ISTAirport Flight Status (GET/POST)
// Forward incoming request to origin with appropriate headers and return JSON/text transparently
app.all('/istairport/status', async (req, res) => {
  try {
    const ORIGIN = (process.env.IST_PROXY_ORIGIN || 'https://www.istairport.com/umbraco/api/FlightInfo/GetFlightStatusBoard').trim();
    const url = new URL(ORIGIN);
    // copy query params
    for (const [k, v] of Object.entries(req.query || {})) {
      if (typeof v === 'string') url.searchParams.set(k, v);
    }

    // Prepare body: keep raw form body if present
    const body = req.method === 'POST'
      ? (typeof req.body === 'string' ? req.body : (req.body ? new URLSearchParams(req.body).toString() : undefined))
      : undefined;

    const resp = await fetch(url.toString(), {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Origin': 'https://www.istairport.com',
        'Referer': 'https://www.istairport.com/',
        'X-Requested-With': 'XMLHttpRequest',
        ...(req.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      },
      body,
    });

    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!resp.ok) {
      return res.status(200).json({ ok: false, status: resp.status, body: json ?? text });
    }
    return res.status(200).json({ ok: true, data: json ?? text });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Mock flight API listening on http://localhost:${port}`);
});
