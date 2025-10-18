/*
 Seed realistic flights for today + next 5 days.
 - At least 10 flights per day (we'll create 6 departures + 6 arrivals = 12/day)
 - Status and estimated times are coherent with schedule and 'now'
 Usage:
   node scripts/seed-realistic.cjs
 Optional env:
   SEED_START_OFFSET_DAYS=0   # 0=today, -1=yesterday, etc.
   SEED_DAYS=6                # total days to generate
*/
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

const airlines = [
  { code: "TK", name: "Turkish Airlines" },
  { code: "PC", name: "Pegasus" },
  { code: "XQ", name: "SunExpress" },
  { code: "W6", name: "Wizz Air" },
  { code: "LY", name: "EL AL" },
  { code: "LH", name: "Lufthansa" },
];

const cities = [
  { city: "Ankara", code: "ESB" },
  { city: "London", code: "LHR" },
  { city: "Berlin", code: "BER" },
  { city: "Paris", code: "CDG" },
  { city: "Amsterdam", code: "AMS" },
  { city: "Rome", code: "FCO" },
  { city: "Vienna", code: "VIE" },
  { city: "Zurich", code: "ZRH" },
  { city: "Baku", code: "GYD" },
  { city: "Tuzla", code: "TZL" },
  { city: "Antalya", code: "AYT" },
  { city: "Izmir", code: "ADB" },
];

function mapStatusToDb(status) {
  const m = {
    "On Time": "On_Time",
    "Delayed": "Delayed",
    "Cancelled": "Cancelled",
    "Boarding": "Boarding",
    "Landed": "Landed",
  };
  return m[status] || "On_Time";
}

function mapDirectionToDb(direction) {
  return direction === "Arrival" ? "Arrival" : "Departure";
}

function toIso(y, m, d, hh, mm) {
  // Local time to ISO string
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

function computeStatusAndEstimated(schedIso, direction, baseNow) {
  const sched = new Date(schedIso);
  const diffMin = Math.round((sched.getTime() - baseNow.getTime()) / 60000);
  // diffMin < 0 => past; > 0 => future
  let status = "On Time";
  let estimatedIso = schedIso;

  if (diffMin < -60) {
    // Long past -> likely landed/cancelled
    const r = Math.random();
    if (r < 0.08) { status = "Cancelled"; estimatedIso = undefined; }
    else { status = "Landed"; estimatedIso = schedIso; }
  } else if (diffMin < 0) {
    // Recent past -> landed or delayed
    const delay = randInt(0, 25);
    status = delay > 10 ? "Delayed" : "Landed";
    estimatedIso = new Date(new Date(schedIso).getTime() + delay * 60000).toISOString();
  } else if (diffMin <= 30 && direction === "Departure") {
    // Imminent departure -> boarding or delayed
    const delay = randInt(0, 20);
    status = delay > 5 ? "Delayed" : "Boarding";
    estimatedIso = new Date(new Date(schedIso).getTime() + delay * 60000).toISOString();
  } else {
    // Future -> mostly on time, some delayed
    const r = Math.random();
    if (r < 0.15) {
      const delay = randInt(5, 30);
      status = "Delayed";
      estimatedIso = new Date(new Date(schedIso).getTime() + delay * 60000).toISOString();
    } else {
      status = "On Time";
      estimatedIso = schedIso;
    }
  }
  return { status, estimatedIso };
}

async function seedDay(date, depCount = 6, arrCount = 6, baseFlightNo = 1000) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const baseNow = new Date();
  baseNow.setHours(12, 0, 0, 0); // noon reference to create mix of past/future

  const dayStartIso = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  const dayEndIso = new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();

  /** build flights array **/
  const batch = [];

  // Departures from IST
  for (let i = 0; i < depCount; i++) {
    const al = pick(airlines);
    const dest = pick(cities);
    const flightNumber = `${al.code}${baseFlightNo + i}`;
    const hour = 7 + i * 1.2; // spread across day
    const hh = Math.floor(hour);
    const mm = Math.round((hour - hh) * 60);
    const schedIso = toIso(y, m, d, hh, mm);
    const { status, estimatedIso } = computeStatusAndEstimated(schedIso, "Departure", baseNow);

    batch.push({
      airportCode: "IST",
      flightNumber,
      airline: al.name,
      direction: mapDirectionToDb("Departure"),
      originCity: "Istanbul",
      destinationCity: dest.city,
      scheduledTimeLocal: schedIso,
      estimatedTimeLocal: estimatedIso ?? null,
      status: mapStatusToDb(status),
      source: "seed:realistic",
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Arrivals to IST
  for (let i = 0; i < arrCount; i++) {
    const al = pick(airlines);
    const orig = pick(cities);
    const flightNumber = `${al.code}${baseFlightNo + 500 + i}`;
    const hour = 9 + i * 1.1;
    const hh = Math.floor(hour);
    const mm = Math.round((hour - hh) * 60);
    const schedIso = toIso(y, m, d, hh, mm);
    const { status, estimatedIso } = computeStatusAndEstimated(schedIso, "Arrival", baseNow);

    batch.push({
      airportCode: "IST",
      flightNumber,
      airline: al.name,
      direction: mapDirectionToDb("Arrival"),
      originCity: orig.city,
      destinationCity: "Istanbul",
      scheduledTimeLocal: schedIso,
      estimatedTimeLocal: estimatedIso ?? null,
      status: mapStatusToDb(status),
      source: "seed:realistic",
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Clean this day's data and insert fresh batch (no transaction/upsert)
  await prisma.flight.deleteMany({
    where: {
      airportCode: "IST",
      scheduledTimeLocal: { gte: dayStartIso, lt: dayEndIso },
    },
  });
  await prisma.flight.createMany({ data: batch, skipDuplicates: true });
}

async function main() {
  const startOffset = Number(process.env.SEED_START_OFFSET_DAYS || 0);
  const days = Number(process.env.SEED_DAYS || 6);
  const start = new Date();
  start.setDate(start.getDate() + startOffset);

  for (let i = 0; i < days; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    await seedDay(day, 6, 6, 1000 + i * 20);
    console.log(`Seeded day ${day.toDateString()}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
