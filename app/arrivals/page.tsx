"use client";

import React from "react";

type ArrivalRow = {
  date: string;
  scheduled: string;
  estimated?: string;
  airline: string;
  flightNumber: string;
  departureAirport: string;
  baggage?: string;
  status: string;
};

function formatTime(dt?: string) {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dt;
  }
}

function formatDateLabel(iso?: string) {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  } catch {
    return iso ?? "";
  }
}

function statusClass(s: string) {
  const v = s.toLowerCase();
  if (v.includes("cancel")) return "text-gray-500"; // cancelled/landed mapped later
  if (v.includes("land")) return "text-gray-600"; // Landed
  if (v.includes("delay")) return "text-orange-600"; // Delayed
  if (v.includes("early")) return "text-blue-600"; // Early
  return "text-emerald-600"; // On Time
}

export default function ArrivalsPage() {
  const [rows, setRows] = React.useState<ArrivalRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [date, setDate] = React.useState<string>(""); // YYYY-MM-DD

  const fetchArrivals = React.useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (date) p.set("date", date);
    if (query) p.set("q", query);
    const resp = await fetch(`/api/aviationstack/arrivals?${p.toString()}`);
    const data = await resp.json();
    setRows(data.arrivals ?? []);
    setLoading(false);
  }, [date, query]);

  React.useEffect(() => { fetchArrivals(); }, [fetchArrivals]);

  // Auto-refresh every 2 minutes
  React.useEffect(() => {
    const id = setInterval(fetchArrivals, 120_000);
    return () => clearInterval(id);
  }, [fetchArrivals]);

  const dateInputValue = React.useMemo(() => {
    if (date) return date;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth()+1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [date]);

  return (
    <div className="min-h-screen px-4 py-6 max-w-[1280px] mx-auto">
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Gelen Uçuşlar</h1>
          <div className="text-sm text-gray-600">{formatDateLabel()}</div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Tarih</label>
            <input
              type="date"
              className="border rounded-md px-3 py-2"
              value={dateInputValue}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Ara (Uçuş No / Kalkış / Hava Yolu)</label>
            <input
              className="border rounded-md px-3 py-2 min-w-[240px]"
              placeholder="Örn: TK1500 veya Antalya"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchArrivals(); }}
            />
          </div>
          <button
            onClick={fetchArrivals}
            className="h-10 px-4 rounded-md text-white"
            style={{ background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" }}
          >
            Uygula
          </button>
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="font-semibold text-gray-900">Gelen Uçuşlar</div>
          <div className="w-40 h-2 rounded-full bg-white/60 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full ist-bar"></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-600">
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Planlanan / Tahmini</th>
                <th className="px-3 py-2">Hava Yolu</th>
                <th className="px-3 py-2">Uçuş No</th>
                <th className="px-3 py-2">Kalkış</th>
                <th className="px-3 py-2">Bagaj</th>
                <th className="px-3 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="px-3 py-4 text-gray-500" colSpan={7}>Yükleniyor...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td className="px-3 py-4 text-gray-500" colSpan={7}>UçuF bulunamad3.
                </td></tr>
              )}
              {!loading && rows.map((r, idx) => (
                <tr key={`${r.flightNumber}-${idx}`} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateLabel(r.date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatTime(r.scheduled)}{r.estimated ? ` / ${formatTime(r.estimated)}` : ""}
                  </td>
                  <td className="px-3 py-2">{r.airline}</td>
                  <td className="px-3 py-2 font-semibold">{r.flightNumber}</td>
                  <td className="px-3 py-2">{r.departureAirport}</td>
                  <td className="px-3 py-2">{r.baggage ?? "-"}</td>
                  <td className={`px-3 py-2 font-medium ${statusClass(r.status)}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
