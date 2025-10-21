export type FlightDirection = "Departure" | "Arrival";

export type FlightStatus = "On Time" | "Delayed" | "Cancelled" | "Boarding" | "Landed";

export interface Flight {
	id: string; // unique id in DB or source
	airportCode: string; // e.g., IST
	flightNumber: string; // e.g., TK1971
	airline: string; // e.g., Turkish Airlines
	direction: FlightDirection; // Departure or Arrival
	originCity: string; // for arrivals
	destinationCity: string; // for departures
	scheduledTimeLocal: string; // ISO time string in local airport timezone
	estimatedTimeLocal?: string; // ISO time string in local airport timezone
	status: FlightStatus;
	gate?: string; // for departures (Kapı)
	baggage?: string; // for arrivals (Bagaj/Carousel)
}

export interface FlightQuery {
	type?: FlightDirection; // filter by direction
	city?: string; // origin for arrivals, destination for departures
	flightNumber?: string; // direct lookup
}


