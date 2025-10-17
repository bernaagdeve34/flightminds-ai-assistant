import { Flight } from "../types";

// Sample static flights for Istanbul Airport (IST)
export const flights: Flight[] = [
	{
		id: "1",
		airportCode: "IST",
		flightNumber: "TK1971",
		airline: "Turkish Airlines",
		direction: "Departure",
		originCity: "Istanbul",
		destinationCity: "London",
		scheduledTimeLocal: new Date().toISOString(),
		estimatedTimeLocal: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		status: "On Time",
	},
	{
		id: "2",
		airportCode: "IST",
		flightNumber: "W43819",
		airline: "Wizz Air",
		direction: "Arrival",
		originCity: "Tuzla",
		destinationCity: "Istanbul",
		scheduledTimeLocal: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
		estimatedTimeLocal: new Date(Date.now() + 2.2 * 60 * 60 * 1000).toISOString(),
		status: "Delayed",
	},
	{
		id: "3",
		airportCode: "IST",
		flightNumber: "W44279",
		airline: "Wizz Air",
		direction: "Arrival",
		originCity: "Tuzla",
		destinationCity: "Istanbul",
		scheduledTimeLocal: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
		estimatedTimeLocal: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
		status: "On Time",
	},
	{
		id: "4",
		airportCode: "IST",
		flightNumber: "PC2101",
		airline: "Pegasus",
		direction: "Departure",
		originCity: "Istanbul",
		destinationCity: "Ankara",
		scheduledTimeLocal: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		estimatedTimeLocal: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		status: "Boarding",
	},
];


