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
  const [scope, setScope] = React.useState<"domestic" | "international">("domestic");
  const t = i18n[lang];

  React.useEffect(() => {
    async function load() {
      try {
        // 1) Tek istek: İç veya Dış hat, clickedButton ile yönü belirt
        const clickedButton = ""; // İGA: boş bırakıyoruz
        const nature = leftTab === "departures" ? "1" : "0"; // Kullanıcı kuralı: kalkış=1, varış=0

        const isInternational = scope === "international" ? "1" : "0";
        const body = new URLSearchParams({
          nature,
          searchTerm: "",
          pageSize: "100",
          isInternational,
          date: "",
          endDate: "",
          culture: lang === "tr" ? "tr" : "en",
          clickedButton,
        }).toString();

        const resp = await fetch(`/api/istairport/status`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const json = await resp.json().catch(() => ({} as any));
        const flights: any[] = (json?.data ?? json)?.result?.data?.flights || [];

        // 2) Map to our Flight type. Yönü sol sekmeden al (daha net)
        const direction = leftTab === "departures" ? "Departure" : "Arrival";
        const statusMap = (s?: string) => {
          const v = (s || "").toLowerCase();
          if (v.includes("iptal")) return "Cancelled";
          if (v.includes("gecik")) return "Delayed";
          if (v.includes("indi") || v.includes("land")) return "Landed" as any;
          if (v.includes("erken")) return "Early" as any;
          return "On Time";
        };
        const mappedAll: Flight[] = flights.map((f) => ({
          id: `${String(f?.flightNumber)}-${direction === "Arrival" ? "ARR" : "DEP"}-${String(f?.scheduledDatetime)}`,
          airportCode: "IST",
          flightNumber: String(f?.flightNumber || ""),
          airline: String(f?.airlineName || f?.airlineCode || ""),
          direction,
          originCity: String(f?.fromCityName || f?.fromCityCode || ""),
          destinationCity: String(f?.toCityName || f?.toCityCode || ""),
          scheduledTimeLocal: String(f?.scheduledDatetime || ""),
          estimatedTimeLocal: f?.estimatedDatetime ? String(f?.estimatedDatetime) : undefined,
          status: statusMap(f?.remark || f?.remarkCode),
          gate: direction === "Departure" ? (f?.gate ? String(f.gate) : undefined) : undefined,
          baggage: direction === "Arrival" ? (f?.carousel ? String(f.carousel) : undefined) : undefined,
        } as Flight));

        setAllFlights(mappedAll);
      } catch (e) {
        console.error("Home table fetch error:", e);
        setAllFlights([]);
      }
    }
    load();
  }, [leftTab, scope, lang]);

  const departures = allFlights.filter((f) => f.direction === "Departure").sort(byTime);
  const arrivals = allFlights.filter((f) => f.direction === "Arrival").sort(byTime);
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-fuchsia-50">
      {showIntro && <SplashIntro language={lang} durationMs={3000} onDone={() => setShowIntro(false)} />}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 text-white shadow-md"
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
          <div className="mb-3 inline-flex rounded-full overflow-hidden border border-white/60 bg-white/90">
            <button
              className={`px-4 py-1.5 text-sm ${scope === "domestic" ? "text-white" : "text-gray-800"}`}
              style={scope === "domestic" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
              onClick={() => setScope("domestic")}
            >
              {lang === "tr" ? "İç Hatlar" : "Domestic"}
            </button>
            <button
              className={`px-4 py-1.5 text-sm border-l ${scope === "international" ? "text-white" : "text-gray-800"}`}
              style={scope === "international" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
              onClick={() => setScope("international")}
            >
              {lang === "tr" ? "Dış Hatlar" : "International"}
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

