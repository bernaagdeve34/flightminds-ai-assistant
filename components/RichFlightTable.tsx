import React from "react";
import { i18n } from "@/lib/i18n";
import type { Flight } from "@/lib/types";

interface Props {
  title: string;
  flights: Flight[];
  language?: "tr" | "en";
}

function formatTime(dt?: string) {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dt;
  }
}

function formatDateLabel(language: "tr" | "en") {
  try {
    const d = new Date();
    return d.toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", {
      year: "numeric", month: "long", day: "numeric", weekday: "long",
    });
  } catch {
    return "";
  }
}

function statusClass(s: string) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel")) return "bg-rose-50 text-rose-700 border border-rose-200";
  if (v.includes("land")) return "bg-gray-50 text-gray-700 border border-gray-200";
  if (v.includes("delay")) return "bg-orange-50 text-orange-700 border border-orange-200";
  if (v.includes("early")) return "bg-sky-50 text-sky-700 border border-sky-200";
  return "bg-emerald-50 text-emerald-700 border border-emerald-200";
}

function badge(content?: string) {
  if (!content) return "-";
  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-100 text-cyan-800 border border-cyan-200 whitespace-nowrap">
      {content}
    </span>
  );
}

export default function RichFlightTable({ title, flights, language = "tr" }: Props) {
  const t = i18n[language];
  const dateLabel = formatDateLabel(language);
  const tableDirection = flights[0]?.direction ?? "Departure";

  return (
    <div className="card-surface overflow-hidden">
      <div className="px-4 pt-3 2xl:px-6 2xl:pt-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-gray-900 2xl:text-lg">{title}</div>
          <div className="w-44 h-2 rounded-full bg-white/70 relative overflow-hidden 2xl:w-52">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full ist-bar"></div>
          </div>
        </div>
        <div className="mt-1 text-xs font-medium text-gray-600 2xl:text-sm">{dateLabel}</div>
        <div className="mt-2 h-[2px] w-full rounded-full" style={{background:"linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))"}} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm 2xl:text-base">
          <thead>
            <tr className="bg-white text-left border-y border-gray-100">
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{language === "tr" ? "Tarih" : "Date"}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{language === "tr" ? "Planlanan / Tahmini" : "Scheduled / Estimated"}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{language === "tr" ? "Hava Yolu" : "Airline"}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{language === "tr" ? "Uçuş No" : "Flight No"}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{language === "tr" ? "Kalkış / Varış" : "Origin / Dest"}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{tableDirection === "Arrival" ? (language === "tr" ? "Bagaj" : "Baggage") : (language === "tr" ? "Kapı" : "Gate")}</th>
              <th className="px-3 py-2 font-semibold 2xl:px-5 2xl:py-3" style={{color:"var(--ist-teal)"}}>{t.headers.status}</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-700 2xl:px-5 2xl:py-3">{new Date(f.scheduledTimeLocal).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-800 2xl:px-5 2xl:py-3">
                  <span>{formatTime(f.scheduledTimeLocal)}</span>
                  {f.estimatedTimeLocal && (
                    <>
                      {" "}/<span className="text-orange-600 font-semibold"> {formatTime(f.estimatedTimeLocal)} </span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700 2xl:px-5 2xl:py-3">{f.airline}</td>
                <td className="px-3 py-2 font-semibold text-gray-900 2xl:px-5 2xl:py-3">{f.flightNumber}</td>
                <td className="px-3 py-2 text-gray-700 2xl:px-5 2xl:py-3">{f.direction === "Arrival" ? f.originCity : f.destinationCity}</td>
                <td className="px-3 py-2 2xl:px-5 2xl:py-3">{f.direction === "Arrival" ? badge(f.baggage) : badge(f.gate)}</td>
                <td className="px-3 py-2 whitespace-nowrap 2xl:px-5 2xl:py-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${statusClass(f.status)}`}>{f.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
