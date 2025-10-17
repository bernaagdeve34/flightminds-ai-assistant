import { prisma } from "./client";
import { Flight as UiFlight, FlightStatus as UiFlightStatus, FlightDirection as UiFlightDirection } from "@/lib/types";

function mapStatus(status: string): UiFlightStatus {
	const m: Record<string, UiFlightStatus> = {
		On_Time: "On Time",
		Delayed: "Delayed",
		Cancelled: "Cancelled",
		Boarding: "Boarding",
		Landed: "Landed",
	};
	return m[status] ?? "On Time";
}

function mapDirection(direction: string): UiFlightDirection {
	return direction === "Arrival" ? "Arrival" : "Departure";
}

export async function fetchFlightsFromDb(): Promise<UiFlight[]> {
	if (!process.env.DATABASE_URL) return [];
	const rows = await prisma.flight.findMany({ orderBy: { scheduledTimeLocal: "asc" } });
	return rows.map((r) => ({
		id: String(r.id),
		airportCode: r.airportCode,
		flightNumber: r.flightNumber,
		airline: r.airline,
		direction: mapDirection(r.direction as string),
		originCity: r.originCity,
		destinationCity: r.destinationCity,
		scheduledTimeLocal: r.scheduledTimeLocal as unknown as string,
		estimatedTimeLocal: (r.estimatedTimeLocal as unknown as string) ?? undefined,
		status: mapStatus(r.status as string),
	}));
}


