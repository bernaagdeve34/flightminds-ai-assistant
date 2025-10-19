"use client";
import React from "react";
import LanguageSwitch, { Lang } from "@/components/LanguageSwitch";
import FlightTable from "@/components/FlightTable";
import AssistantPanel from "@/components/AssistantPanel";
import RichFlightTable from "@/components/RichFlightTable";
import SplashIntro from "@/components/SplashIntro";
import { byTime } from "@/lib/utils";
import { i18n } from "@/lib/i18n";
import type { Flight } from "@/lib/types";

export default function Home() {
  const [lang, setLang] = React.useState<Lang>("tr");
  const [allFlights, setAllFlights] = React.useState<Flight[]>([]);
  const [showIntro, setShowIntro] = React.useState(true);
  const [leftTab, setLeftTab] = React.useState<"departures" | "arrivals">("departures");
  const t = i18n[lang];

  React.useEffect(() => {
    async function load() {
      try {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const date = `${yyyy}-${mm}-${dd}`;
        const base = leftTab === "departures" ? "/api/aviationstack/departures" : "/api/aviationstack/arrivals";
        const resp = await fetch(`${base}?date=${date}`, { cache: "no-store" });
        const json = await resp.json();
        const rows: any[] = leftTab === "departures" ? (json.departures ?? []) : (json.arrivals ?? []);
        let useRows = rows;
        if (!Array.isArray(useRows) || useRows.length === 0) {
          // Retry without date to trigger provider's live/status fallback
          const retry = await fetch(base, { cache: "no-store" }).then(r => r.json()).catch(() => ({ }));
          useRows = leftTab === "departures" ? (retry.departures ?? []) : (retry.arrivals ?? []);
        }
        const mapped: Flight[] = (useRows as any[]).map((r) => {
          if (leftTab === "departures") {
            return {
              id: `${r.flightNumber}-DEP-${r.scheduled}`,
              airportCode: "IST",
              flightNumber: String(r.flightNumber),
              airline: String(r.airline || ""),
              direction: "Departure",
              originCity: "Istanbul",
              destinationCity: String(r.destinationAirport || ""),
              scheduledTimeLocal: r.scheduled,
              estimatedTimeLocal: r.estimated,
              status: String(r.status || "On Time"),
            } as Flight;
          }
          return {
            id: `${r.flightNumber}-ARR-${r.scheduled}`,
            airportCode: "IST",
            flightNumber: String(r.flightNumber),
            airline: String(r.airline || ""),
            direction: "Arrival",
            originCity: String(r.departureAirport || ""),
            destinationCity: "Istanbul",
            scheduledTimeLocal: r.scheduled,
            estimatedTimeLocal: r.estimated,
            status: String(r.status || "On Time"),
          } as Flight;
        });
        setAllFlights(mapped);
      } catch (e) {
        console.error("Home table fetch error:", e);
        setAllFlights([]);
      }
    }
    load();
  }, [leftTab]);

  const departures = allFlights.filter((f) => f.direction === "Departure").sort(byTime);
  const arrivals = allFlights.filter((f) => f.direction === "Arrival").sort(byTime);
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-fuchsia-50">
      {showIntro && <SplashIntro language={lang} onDone={() => setShowIntro(false)} />}
      <header
        className="flex items-center justify-between px-6 py-3 text-white"
        style={{ background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" }}
      >
        <div className="flex items-center gap-3">
          <img src="/ist_logtwo.png" alt="IST" className="h-8 w-8 object-contain" />
          <h1 className="text-lg font-semibold">{t.pageTitle}</h1>
        </div>
        <LanguageSwitch value={lang} onChange={setLang} />
      </header>
      <main className="px-6 py-8 max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <div className="mb-3 inline-flex rounded-md overflow-hidden border border-white/60 bg-white/90">
            <button
              className={`px-4 py-2 text-sm font-medium ${leftTab === "departures" ? "text-white" : "text-gray-800"}`}
              style={leftTab === "departures" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
              onClick={() => setLeftTab("departures")}
            >
              {t.departures}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-l ${leftTab === "arrivals" ? "text-white" : "text-gray-800"}`}
              style={leftTab === "arrivals" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
              onClick={() => setLeftTab("arrivals")}
            >
              {t.arrivals}
            </button>
          </div>
          {leftTab === "departures" ? (
            <RichFlightTable title={t.departures} flights={departures} language={lang} />
          ) : (
            <RichFlightTable title={t.arrivals} flights={arrivals} language={lang} />
          )}
        </div>
        <div className="lg:col-span-4 lg:self-start lg:mt-[60px]">
          <AssistantPanel language={lang} />
        </div>
      </main>
    </div>
  );
}

