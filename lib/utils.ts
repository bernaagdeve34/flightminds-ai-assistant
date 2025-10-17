import { Flight, FlightDirection, FlightQuery } from "./types";

export function filterFlights(all: Flight[], query: FlightQuery): Flight[] {
	let list = all;
	if (query.type) {
		list = list.filter((f) => f.direction === query.type);
	}
	if (query.city) {
		const city = query.city.toLowerCase();
		list = list.filter((f) =>
			f.direction === "Arrival"
				? f.originCity.toLowerCase().includes(city)
				: f.destinationCity.toLowerCase().includes(city)
		);
	}
	if (query.flightNumber) {
		const num = query.flightNumber.toLowerCase();
		list = list.filter((f) => f.flightNumber.toLowerCase().includes(num));
	}
	return list;
}

export function formatTimeLocal(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	} catch {
		return "-";
	}
}

export function byTime(a: Flight, b: Flight): number {
	return new Date(a.estimatedTimeLocal ?? a.scheduledTimeLocal).getTime() -
		new Date(b.estimatedTimeLocal ?? b.scheduledTimeLocal).getTime();
}

export function isDeparture(direction: FlightDirection): boolean {
	return direction === "Departure";
}


