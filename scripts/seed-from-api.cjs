/* Seed DB with current flights from the running dev server endpoint.
   Requires: `npm run dev` (or the API reachable at localhost:3000)
*/
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function mapStatusToDb(status) {
  const m = {
    "On Time": "On_Time",
    Delayed: "Delayed",
    Cancelled: "Cancelled",
    Boarding: "Boarding",
    Landed: "Landed",
  };
  return m[status] || "On_Time";
}

function mapDirectionToDb(direction) {
  return direction === "Arrival" ? "Arrival" : "Departure";
}

async function main() {
  const base = process.env.SEED_API_BASE || "http://localhost:3000";
  const url = `${base}/api/flights`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const json = await res.json();
  const flights = json.flights || [];
  const fetchedAt = new Date();

  for (const f of flights) {
    try {
      await prisma.flight.upsert({
        where: { flightNumber: String(f.flightNumber) },
        update: {
          airportCode: f.airportCode || "IST",
          airline: f.airline || "",
          direction: mapDirectionToDb(f.direction),
          originCity: f.originCity || "",
          destinationCity: f.destinationCity || "",
          scheduledTimeLocal: f.scheduledTimeLocal,
          estimatedTimeLocal: f.estimatedTimeLocal ?? null,
          status: mapStatusToDb(f.status),
          source: "seed:api",
          fetchedAt,
          updatedAt: new Date(),
        },
        create: {
          airportCode: f.airportCode || "IST",
          flightNumber: String(f.flightNumber),
          airline: f.airline || "",
          direction: mapDirectionToDb(f.direction),
          originCity: f.originCity || "",
          destinationCity: f.destinationCity || "",
          scheduledTimeLocal: f.scheduledTimeLocal,
          estimatedTimeLocal: f.estimatedTimeLocal ?? null,
          status: mapStatusToDb(f.status),
          source: "seed:api",
          fetchedAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (e) {
      console.error("Upsert failed for", f.flightNumber, e?.message || e);
    }
  }
  console.log(`Seeded ${flights.length} flights from ${url}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
