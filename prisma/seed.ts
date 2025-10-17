import { PrismaClient, FlightStatus, FlightDirection } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
	await prisma.flight.deleteMany().catch(() => {});

	await prisma.flight.createMany({
		data: [
			{
				airportCode: "IST",
				flightNumber: "TK1971",
				airline: "Turkish Airlines",
				direction: FlightDirection.Departure,
				originCity: "Istanbul",
				destinationCity: "London",
				scheduledTimeLocal: new Date(),
				estimatedTimeLocal: new Date(Date.now() + 30 * 60 * 1000),
				status: FlightStatus.On_Time,
			},
			{
				airportCode: "IST",
				flightNumber: "W43819",
				airline: "Wizz Air",
				direction: FlightDirection.Arrival,
				originCity: "Tuzla",
				destinationCity: "Istanbul",
				scheduledTimeLocal: new Date(Date.now() + 2 * 60 * 60 * 1000),
				estimatedTimeLocal: new Date(Date.now() + 2.2 * 60 * 60 * 1000),
				status: FlightStatus.Delayed,
			},
			{
				airportCode: "IST",
				flightNumber: "W44279",
				airline: "Wizz Air",
				direction: FlightDirection.Arrival,
				originCity: "Tuzla",
				destinationCity: "Istanbul",
				scheduledTimeLocal: new Date(Date.now() + 5 * 60 * 60 * 1000),
				estimatedTimeLocal: new Date(Date.now() + 5 * 60 * 60 * 1000),
				status: FlightStatus.On_Time,
			},
			{
				airportCode: "IST",
				flightNumber: "PC2101",
				airline: "Pegasus",
				direction: FlightDirection.Departure,
				originCity: "Istanbul",
				destinationCity: "Ankara",
				scheduledTimeLocal: new Date(Date.now() + 60 * 60 * 1000),
				estimatedTimeLocal: new Date(Date.now() + 60 * 60 * 1000),
				status: FlightStatus.Boarding,
			},
		],
	});
}

main().finally(async () => {
	await prisma.$disconnect();
});


