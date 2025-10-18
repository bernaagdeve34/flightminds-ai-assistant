"use client";
import React from "react";
import LanguageSwitch, { Lang } from "@/components/LanguageSwitch";
import FlightTable from "@/components/FlightTable";
import AssistantPanel from "@/components/AssistantPanel";
import SplashIntro from "@/components/SplashIntro";
import { byTime } from "@/lib/utils";
import { i18n } from "@/lib/i18n";
import type { Flight } from "@/lib/types";

export default function Home() {
  const [lang, setLang] = React.useState<Lang>("tr");
  const [allFlights, setAllFlights] = React.useState<Flight[]>([]);
  const [showIntro, setShowIntro] = React.useState(true);
  const t = i18n[lang];

  React.useEffect(() => {
    fetch("/api/flights")
      .then((r) => r.json())
      .then((data) => {
        setAllFlights(data.flights ?? []);
      })
      .catch(() => setAllFlights([]));
  }, []);

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
        <div className="lg:col-span-3">
          <FlightTable title={t.departures} flights={departures} language={lang} />
        </div>
        <div className="lg:col-span-6">
          <AssistantPanel language={lang} />
        </div>
        <div className="lg:col-span-3">
          <FlightTable title={t.arrivals} flights={arrivals} language={lang} />
        </div>
      </main>
    </div>
  );
}

