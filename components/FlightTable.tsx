import React from "react";
import { Flight } from "@/lib/types";
import { formatTimeLocal } from "@/lib/utils";
import { i18n } from "@/lib/i18n";

interface Props {
    title: string;
    flights: Flight[];
    language?: "tr" | "en";
}

export default function FlightTable({ title, flights, language = "tr" }: Props) {
    const t = i18n[language];

    const todayLabel = React.useMemo(() => {
        try {
            const now = new Date();
            const formatted = now.toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
            return `${t.todayPrefix} ${formatted}`;
        } catch {
            return t.todayPrefix;
        }
    }, [language, t.todayPrefix]);

    function statusClass(status: string): string {
        const s = status.toLowerCase();
        if (s.includes("delay") || s.includes("cancel")) return "text-red-600";
        if (s.includes("board")) return "text-amber-600";
        if (s.includes("land")) return "text-emerald-600";
        return "text-emerald-600"; // On Time default
    }

    function localizedStatus(status: string): string {
        // Map English UI statuses to selected language labels
        // Falls back to original if no mapping is found
        // Known statuses: "On Time", "Delayed", "Cancelled", "Boarding", "Landed"
        // Note: DB mapping already converts enums to these UI strings
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map: any = (t as any).statusMap || {};
        return map[status] ?? status;
    }

    return (
        <div className="card-surface overflow-hidden">
            <div className="px-4 pt-4 font-semibold text-gray-900">{title}</div>
            <div className="px-4 pb-3">
                <div className="flex items-center justify-between">
                    <div className="h-2 w-full rounded-full bg-white/50 relative overflow-hidden">
                        <div className="absolute inset-y-0 left-0 w-2/3 rounded-full ist-bar"></div>
                    </div>
                    <div className="ml-3 text-xs font-medium text-gray-700 whitespace-nowrap">
                        {todayLabel}
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50 text-left text-gray-600">
                            <th className="px-3 py-2">{t.headers.flight}</th>
                            <th className="px-3 py-2">{language === "tr" ? "Hedef" : "Destination"}</th>
                            <th className="px-3 py-2">{t.headers.scheduled}</th>
                            <th className="px-3 py-2">{t.headers.estimated}</th>
                            <th className="px-3 py-2">{t.headers.status}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {flights.map((f) => (
                            <tr key={f.id} className="border-t">
                                <td className="px-3 py-2 font-semibold text-gray-900">{f.flightNumber}</td>
                                <td className="px-3 py-2 text-gray-800">
                                    {f.direction === "Arrival" ? f.originCity : f.destinationCity}
                                </td>
                                <td className="px-3 py-2">{formatTimeLocal(f.scheduledTimeLocal)}</td>
                                <td className="px-3 py-2">{formatTimeLocal(f.estimatedTimeLocal ?? f.scheduledTimeLocal)}</td>
                                <td className={`px-3 py-2 font-medium ${statusClass(f.status)}`}>{localizedStatus(f.status)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
