"use client";
import React from "react";
import type { Lang } from "@/components/LanguageSwitch";
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
  const [scope, setScope] = React.useState<"domestic" | "international">("domestic");
  const t = i18n[lang];

  React.useEffect(() => {
    async function load() {
      try {
        const clickedButton = "";
        const isInternational = scope === "international" ? "1" : "0";
        const bodyDep = new URLSearchParams({
          nature: "1",
          searchTerm: "",
          pageSize: "100",
          isInternational,
          date: "",
          endDate: "",
          culture: lang === "tr" ? "tr" : "en",
          clickedButton,
        }).toString();
        const bodyArr = new URLSearchParams({
          nature: "0",
          searchTerm: "",
          pageSize: "100",
          isInternational,
          date: "",
          endDate: "",
          culture: lang === "tr" ? "tr" : "en",
          clickedButton,
        }).toString();

        const [rDep, rArr] = await Promise.all([
          fetch(`/api/istairport/status`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: bodyDep }),
          fetch(`/api/istairport/status`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: bodyArr }),
        ]);
        const [jDep, jArr] = await Promise.all([rDep.json().catch(() => ({} as any)), rArr.json().catch(() => ({} as any))]);
        const depFlights: any[] = (jDep?.data ?? jDep)?.result?.data?.flights || [];
        const arrFlights: any[] = (jArr?.data ?? jArr)?.result?.data?.flights || [];

        const statusMap = (s?: string) => {
          const v = (s || "").toLowerCase();
          if (v.includes("iptal")) return "Cancelled";
          if (v.includes("gecik")) return "Delayed";
          if (v.includes("indi") || v.includes("land")) return "Landed" as any;
          if (v.includes("erken")) return "Early" as any;
          return "On Time";
        };
        const mappedDep: Flight[] = depFlights.map((f) => ({
          id: `${String(f?.flightNumber)}-DEP-${String(f?.scheduledDatetime)}`,
          airportCode: "IST",
          flightNumber: String(f?.flightNumber || ""),
          airline: String(f?.airlineName || f?.airlineCode || ""),
          direction: "Departure",
          originCity: String(f?.fromCityName || f?.fromCityCode || ""),
          destinationCity: String(f?.toCityName || f?.toCityCode || ""),
          scheduledTimeLocal: String(f?.scheduledDatetime || ""),
          estimatedTimeLocal: f?.estimatedDatetime ? String(f?.estimatedDatetime) : undefined,
          status: statusMap(f?.remark || f?.remarkCode),
          gate: f?.gate ? String(f.gate) : undefined,
          baggage: undefined,
        } as Flight));
        const mappedArr: Flight[] = arrFlights.map((f) => ({
          id: `${String(f?.flightNumber)}-ARR-${String(f?.scheduledDatetime)}`,
          airportCode: "IST",
          flightNumber: String(f?.flightNumber || ""),
          airline: String(f?.airlineName || f?.airlineCode || ""),
          direction: "Arrival",
          originCity: String(f?.fromCityName || f?.fromCityCode || ""),
          destinationCity: String(f?.toCityName || f?.toCityCode || ""),
          scheduledTimeLocal: String(f?.scheduledDatetime || ""),
          estimatedTimeLocal: f?.estimatedDatetime ? String(f?.estimatedDatetime) : undefined,
          status: statusMap(f?.remark || f?.remarkCode),
          gate: undefined,
          baggage: f?.carousel ? String(f.carousel) : undefined,
        } as Flight));

        setAllFlights([...mappedDep, ...mappedArr]);
      } catch (e) {
        console.error("Home table fetch error:", e);
        setAllFlights([]);
      }
    }
    load();
  }, [scope, lang]);

  const departures = allFlights.filter((f) => f.direction === "Departure").sort(byTime);
  const arrivals = allFlights.filter((f) => f.direction === "Arrival").sort(byTime);
  return (
    <div className="min-h-screen">
      {showIntro && <SplashIntro language={lang} durationMs={3000} onDone={() => setShowIntro(false)} />}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3 bg-white text-gray-900 border-b border-gray-200/60 shadow-none">
        <div className="flex items-center gap-3">
          <img src="/ist_logtwo.png" alt="IST" className="h-8 w-8 object-contain" />
          <h1 className="text-lg font-semibold">{t.pageTitle}</h1>
        </div>
        <div className="inline-flex rounded-full overflow-hidden border border-gray-200 bg-white">
          <button
            className={`px-3 py-1 text-sm ${lang === "tr" ? "text-white" : "text-gray-800"}`}
            style={lang === "tr" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
            onClick={() => setLang("tr")}
          >
            TR
          </button>
          <button
            className={`px-3 py-1 text-sm border-l ${lang === "en" ? "text-white" : "text-gray-800"}`}
            style={lang === "en" ? { background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" } : {}}
            onClick={() => setLang("en")}
          >
            EN
          </button>
        </div>
      </header>
      {/* Global centered scope toggle */}
      <section className="w-full flex items-center justify-center py-3">
        <div className="inline-flex rounded-full overflow-hidden border border-gray-200 bg-white shadow-sm">
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
      </section>
      <main className="mx-auto px-4 sm:px-6 lg:px-8 2xl:px-10 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 2xl:grid-cols-14 gap-4 sm:gap-6 xl:gap-8 max-w-screen-2xl 2xl:max-w-[1760px]">
        <div className="lg:col-span-4 2xl:col-span-5 lg:self-start">
          <RichFlightTable title={t.departures} flights={departures} language={lang} />
        </div>
        <div className="lg:col-span-4 2xl:col-span-4 lg:self-start">
          <AssistantPanel language={lang} scope={scope} />
        </div>
        <div className="lg:col-span-4 2xl:col-span-5 lg:self-start">
          <RichFlightTable title={t.arrivals} flights={arrivals} language={lang} />
        </div>
      </main>
    </div>
  );
}

