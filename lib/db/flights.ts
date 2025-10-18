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
    return rows.map((r: any) => ({
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

// Reverse mappers for saving UI flights back to DB enums
function mapStatusToDb(status: UiFlightStatus): string {
    const m: Record<UiFlightStatus, string> = {
        "On Time": "On_Time",
        Delayed: "Delayed",
        Cancelled: "Cancelled",
        Boarding: "Boarding",
        Landed: "Landed",
    };
    return m[status] ?? "On_Time";
}

function mapDirectionToDb(direction: UiFlightDirection): string {
    return direction === "Arrival" ? "Arrival" : "Departure";
}

export async function getRecentFlights(ttlMinutes: number, airportCode = "IST"): Promise<UiFlight[]> {
    if (!process.env.DATABASE_URL) return [];
    const threshold = new Date(Date.now() - ttlMinutes * 60 * 1000);
    const rows = await prisma.flight.findMany({
        where: {
            airportCode,
            fetchedAt: { gte: threshold },
        },
        orderBy: { scheduledTimeLocal: "asc" },
    });
    return rows.map((r: any) => ({
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

export async function saveFlightsSnapshot(flights: UiFlight[], source = "provider:unknown"): Promise<void> {
    if (!process.env.DATABASE_URL) return;
    const fetchedAt = new Date();
    // Optional: clear previous snapshot for same airport within recent window
    // For simplicity, upsert by flightNumber
    for (const f of flights) {
        await prisma.flight.upsert({
            where: { flightNumber: f.flightNumber },
            update: {
                airportCode: f.airportCode,
                airline: f.airline,
                direction: mapDirectionToDb(f.direction) as any,
                originCity: f.originCity,
                destinationCity: f.destinationCity,
                scheduledTimeLocal: f.scheduledTimeLocal as any,
                estimatedTimeLocal: (f.estimatedTimeLocal as any) ?? null,
                status: mapStatusToDb(f.status) as any,
                source,
                fetchedAt,
                updatedAt: new Date(),
            },
            create: {
                airportCode: f.airportCode,
                flightNumber: f.flightNumber,
                airline: f.airline,
                direction: mapDirectionToDb(f.direction) as any,
                originCity: f.originCity,
                destinationCity: f.destinationCity,
                scheduledTimeLocal: f.scheduledTimeLocal as any,
                estimatedTimeLocal: (f.estimatedTimeLocal as any) ?? null,
                status: mapStatusToDb(f.status) as any,
                source,
                fetchedAt,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }
}
