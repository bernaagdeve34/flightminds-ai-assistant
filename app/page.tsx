"use client";
import React from "react";
import LanguageSwitch, { Lang } from "@/components/LanguageSwitch";
import FlightTable from "@/components/FlightTable";
import AssistantPanel from "@/components/AssistantPanel";
import SplashIntro from "@/components/SplashIntro";
import { byTime } from "@/lib/utils";

type Flight = {
  id: string;
  airportCode: string;
  flightNumber: string;
  airline: string;
  direction: "Departure" | "Arrival";
  originCity: string;
  destinationCity: string;
  scheduledTimeLocal: string;
  estimatedTimeLocal?: string;
  status: string;
};

export default function Home() {
  const [lang, setLang] = React.useState<Lang>("tr");
  const [allFlights, setAllFlights] = React.useState<Flight[]>([]);
  const [showIntro, setShowIntro] = React.useState(true);

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
    <div className="min-h-screen bg-gray-100">
      {showIntro && <SplashIntro language={lang} onDone={() => setShowIntro(false)} />}
      <header className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <h1 className="text-lg font-semibold">İstanbul Havalimanı Uçuş Asistanı</h1>
        <LanguageSwitch value={lang} onChange={setLang} />
      </header>
      <main className="px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <FlightTable title={lang === "tr" ? "Giden Uçuşlar" : "Departures"} flights={departures} />
        </div>
        <div className="lg:col-span-1">
          <AssistantPanel language={lang} />
        </div>
        <div className="lg:col-span-1">
          <FlightTable title={lang === "tr" ? "Gelen Uçuşlar" : "Arrivals"} flights={arrivals} />
        </div>
      </main>
    </div>
  );
}
