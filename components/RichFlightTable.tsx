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
  if (v.includes("cancel")) return "text-gray-500";
  if (v.includes("land")) return "text-gray-600";
  if (v.includes("delay")) return "text-orange-600";
  if (v.includes("early")) return "text-blue-600";
  return "text-emerald-600";
}

export default function RichFlightTable({ title, flights, language = "tr" }: Props) {
  const t = i18n[language];
  const dateLabel = formatDateLabel(language);
  const tableDirection = flights[0]?.direction ?? "Departure";

  return (
    <div className="card-surface overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="font-semibold text-gray-900">{title}</div>
        <div className="w-40 h-2 rounded-full bg-white/60 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/2 rounded-full ist-bar"></div>
        </div>
      </div>
      <div className="px-4 pb-3 text-xs font-medium text-gray-700">{dateLabel}</div>
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
                <td className="px-3 py-2">{f.direction === "Arrival" ? (f.baggage ?? "-") : (f.gate ?? "-")}</td>
                <td className={`px-3 py-2 font-medium ${statusClass(f.status)}`}>{f.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
