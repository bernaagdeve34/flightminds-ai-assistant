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
  if (v.includes("cancel")) return "bg-gray-200 text-gray-700";
  if (v.includes("land")) return "bg-gray-100 text-gray-700";
  if (v.includes("delay")) return "bg-rose-100 text-rose-700";
  if (v.includes("early")) return "bg-sky-100 text-sky-700";
  return "bg-emerald-100 text-emerald-700";
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
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="w-44 h-2 rounded-full bg-white/60 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full ist-bar"></div>
          </div>
        </div>
        <div className="mt-1 text-xs font-medium text-gray-700">{dateLabel}</div>
        <div className="mt-2 h-1 w-full rounded-full" style={{background:"linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))"}} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-600">
              <th className="px-3 py-2">{language === "tr" ? "Tarih" : "Date"}</th>
              <th className="px-3 py-2">{language === "tr" ? "Planlanan / Tahmini" : "Scheduled / Estimated"}</th>
              <th className="px-3 py-2">{language === "tr" ? "Hava Yolu" : "Airline"}</th>
              <th className="px-3 py-2">{language === "tr" ? "Uçuş No" : "Flight No"}</th>
              <th className="px-3 py-2">{language === "tr" ? "Kalkış / Varış" : "Origin / Dest"}</th>
              <th className="px-3 py-2">{tableDirection === "Arrival" ? (language === "tr" ? "Bagaj" : "Baggage") : (language === "tr" ? "Kapı" : "Gate")}</th>
              <th className="px-3 py-2">{t.headers.status}</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(f.scheduledTimeLocal).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatTime(f.scheduledTimeLocal)}{f.estimatedTimeLocal ? ` / ${formatTime(f.estimatedTimeLocal)}` : ""}</td>
                <td className="px-3 py-2">{f.airline}</td>
                <td className="px-3 py-2 font-semibold">{f.flightNumber}</td>
                <td className="px-3 py-2">{f.direction === "Arrival" ? f.originCity : f.destinationCity}</td>
                <td className="px-3 py-2">{f.direction === "Arrival" ? badge(f.baggage) : badge(f.gate)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded-full border ${statusClass(f.status)}`}>{f.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
