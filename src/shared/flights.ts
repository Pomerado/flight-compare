/**
 * One shape for every site's flights, so cash fares and award prices line up.
 *
 * The tools' output schemas come from Pomerado's catalog (GET /v1/tools/{id}), which needs a key.
 * These normalizers read the Google Flights shape Pomerado's public Try it shows and a typed
 * award shape. Field names marked VERIFY are guesses to check against each tool's output_schema.
 */

export type TripScope = "one_way" | "round_trip" | "outbound_only";

export type CashPrice = {
  kind: "cash";
  amountMinor: number;
  currency: string;
  scope: TripScope;
};

export type AwardPrice = {
  kind: "award";
  /** The program, keyed into COPY.programs. */
  program: string;
  points: number;
  taxesMinor: number | null;
  taxesCurrency: string | null;
  scope: TripScope;
};

export type Source = { key: string; label: string; url: string | null };

export type FlightOption = {
  id: string;
  source: Source;
  carrier: string | null;
  /** The first airline's two-letter code, when the name is known. */
  carrierCode: string | null;
  flightNumbers: string[];
  origin: string | null;
  destination: string | null;
  /** As the site shows it: "7:00 AM", or "8:25 AM+1" for the next day. */
  departTime: string | null;
  arriveTime: string | null;
  /** Minutes after midnight on the departure day; a next-day arrival adds 1440. */
  departMinutes: number | null;
  arriveMinutes: number | null;
  durationMinutes: number | null;
  stops: number | null;
  via: string[];
  price: CashPrice | AwardPrice;
};

type Data = Record<string, unknown>;

const record = (value: unknown): Data | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Data) : null;
const records = (value: unknown): Data[] =>
  Array.isArray(value) ? value.flatMap((item) => (record(item) ? [item as Data] : [])) : [];
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const httpsUrl = (value: unknown) => {
  const found = text(value);
  return found && /^https:\/\//i.test(found) ? found : null;
};
/** The first field present, for shapes whose names aren't confirmed yet. */
const first = (row: Data, names: string[]) => names.map((name) => row[name]).find((value) => value !== undefined && value !== null);

/** The names flight sites show, with their codes. */
const AIRLINE_CODES: [name: string, code: string][] = [
  ["Alaska", "AS"],
  ["JetBlue", "B6"],
  ["United", "UA"],
  ["Delta", "DL"],
  ["American", "AA"],
  ["Southwest", "WN"],
  ["Spirit", "NK"],
  ["Frontier", "F9"],
  ["Hawaiian", "HA"],
  ["Sun Country", "SY"],
  ["Allegiant", "G4"],
  ["Breeze", "MX"],
  ["Avelo", "XP"],
  ["Air Canada", "AC"],
  ["WestJet", "WS"],
  ["Aeromexico", "AM"],
  ["Aeroméxico", "AM"],
  ["British Airways", "BA"],
  ["Virgin Atlantic", "VS"],
  ["Aer Lingus", "EI"],
  ["Lufthansa", "LH"],
  ["Air France", "AF"],
  ["KLM", "KL"],
  ["Iberia", "IB"],
  ["Turkish Airlines", "TK"],
  ["Emirates", "EK"],
  ["Qatar Airways", "QR"],
  ["Japan Airlines", "JL"],
  ["ANA", "NH"],
  ["Cathay Pacific", "CX"],
  ["Singapore Airlines", "SQ"],
];

/** "Alaska, Hawaiian" -> AS; "DL" -> DL; unknown names -> null. */
export function carrierCode(airline: string | null): string | null {
  const name = (airline ?? "").split(/,|·|\+|\//)[0]?.trim() ?? "";
  if (/^[A-Z0-9]{2}$/.test(name)) return name;
  const lower = name.toLowerCase();
  const found = AIRLINE_CODES.find(([known]) => {
    const key = known.toLowerCase();
    return lower === key || lower.startsWith(`${key} `);
  });
  return found ? found[1] : null;
}

/** "DL 123", "dl0123" -> DL123 */
const flightNumber = (value: string) => {
  const match = /^([A-Z0-9]{2})\s*0*(\d{1,4})$/i.exec(value.trim());
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : null;
};

function flightNumbers(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,/]/) : [];
  return list.flatMap((item) => {
    const found = typeof item === "string" ? flightNumber(item) : null;
    return found ? [found] : [];
  });
}

/**
 * "7:00 AM" -> 420, "8:25 AM+1" -> 1945, "19:05" -> 1145, "2026-11-09T07:00:00" -> 420.
 * `dayShift` adds whole days, for an arrival date after the departure date.
 */
export function minutesOf(value: string | null, dayShift = 0): number | null {
  if (value === null) return null;
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(value);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]) + dayShift * 1440;
  const match = /^(\d{1,2}):(\d{2})\s*([AP]M)?\s*(?:\+(\d))?$/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  const plus = match[4] ? Number(match[4]) : 0;
  return hours * 60 + Number(match[2]) + (plus + dayShift) * 1440;
}

/** Whole days between two YYYY-MM-DD dates, else 0. */
function daysBetween(from: unknown, to: unknown) {
  const a = text(from);
  const b = text(to);
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return 0;
  const days = Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** "08:25" with a later arrival date reads "8:25 AM+1", the way the flight sites print it. */
function clockText(value: string | null, dayShift: number): string | null {
  if (value === null) return null;
  if (/\+\d$/.test(value)) return value;
  if (/[AP]M/i.test(value)) return dayShift > 0 ? `${value}+${dayShift}` : value;
  const minutes = minutesOf(value);
  if (minutes === null) return value;
  const hours = Math.floor(minutes / 60) % 24;
  const clock = `${((hours + 11) % 12) + 1}:${String(minutes % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return dayShift > 0 ? `${clock}+${dayShift}` : clock;
}

function viaOf(row: Data): string[] {
  const connections = records(first(row, ["connections", "layovers"]));
  return connections.flatMap((connection) => {
    const airport = text(first(connection, ["airport", "airport_code", "code"]));
    return airport ? [airport] : [];
  });
}

/** The parts every site's row shares: airline, flight numbers, airports, times, duration, stops. */
function flightParts(row: Data) {
  const carrier = text(first(row, ["airline", "carrier", "operating_airline", "marketing_airline"]));
  const shift = daysBetween(row.departure_date, row.arrival_date);
  const departRaw = text(first(row, ["departure_time", "depart_time", "departs_at"]));
  const arriveRaw = text(first(row, ["arrival_time", "arrive_time", "arrives_at"]));
  const via = viaOf(row);
  const stops = count(row.stops) ?? (Array.isArray(row.connections) ? via.length : null);
  return {
    carrier,
    carrierCode: carrierCode(carrier),
    // VERIFY: flight_numbers isn't in the Try it shape; award tools may name it flight_number.
    flightNumbers: flightNumbers(first(row, ["flight_numbers", "flight_number"])),
    origin: text(first(row, ["origin_airport", "origin"])),
    destination: text(first(row, ["destination_airport", "destination"])),
    departTime: clockText(departRaw, 0),
    arriveTime: clockText(arriveRaw, shift),
    departMinutes: minutesOf(departRaw),
    arriveMinutes: minutesOf(arriveRaw, /\+\d$/.test(arriveRaw ?? "") ? 0 : shift),
    durationMinutes: count(first(row, ["duration_minutes", "total_duration_minutes"])),
    stops,
    via,
  };
}

export type NormalizeContext = { key: string; label: string; scope: TripScope };

/**
 * Google Flights' search result: `flights`, each with Google's displayed fare in cents
 * (`price_minor`), and `search_url` for the same search on Google. Unpriced flights are left out.
 * VERIFY for the round-trip tool: that `flights` lists outbound flights priced for the round trip.
 */
export function normalizeGoogleFlights(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.search_url);
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const amount = count(row.price_minor);
    if (amount === null || amount <= 0) return [];
    return [
      {
        id: `${context.key}-${index}`,
        source: { key: context.key, label: context.label, url: httpsUrl(row.booking_url) ?? url },
        ...flightParts(row),
        price: {
          kind: "cash",
          amountMinor: amount,
          currency: text(row.currency) ?? "USD",
          scope: context.scope,
        },
      },
    ];
  });
}

/**
 * An airline's award search. VERIFY every field: the rows' list (`flights`, else `results`,
 * `awards` or `itineraries`), the points (`miles`, else `points` or `award_miles`), the taxes in
 * cents (`taxes_minor`, else `taxes_and_fees_minor` or `fees_minor`) and their currency. A row
 * with several fares (`fares`) takes the fare in the asked cabin, else its fewest points.
 */
export function normalizeAward(
  result: unknown,
  context: NormalizeContext & { program: string; cabin?: string },
): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const rows = [data.flights, data.results, data.awards, data.itineraries].map(records).find((list) => list.length > 0) ?? [];
  const url = httpsUrl(first(data, ["search_url", "results_url"]));
  return rows.flatMap((row, index): FlightOption[] => {
    const fare = pickFare(row, context.cabin);
    if (!fare) return [];
    const points = count(first(fare, ["miles", "points", "award_miles", "miles_required"]));
    if (points === null || points <= 0) return [];
    const taxes = count(first(fare, ["taxes_minor", "taxes_and_fees_minor", "fees_minor"]));
    return [
      {
        id: `${context.key}-${index}`,
        source: { key: context.key, label: context.label, url: httpsUrl(first(row, ["booking_url", "url"])) ?? url },
        ...flightParts(row),
        price: {
          kind: "award",
          program: context.program,
          points,
          taxesMinor: taxes,
          taxesCurrency: taxes === null ? null : (text(first(fare, ["taxes_currency", "currency"])) ?? "USD"),
          scope: context.scope,
        },
      },
    ];
  });
}

function pickFare(row: Data, cabin: string | undefined): Data | null {
  const fares = records(row.fares);
  if (fares.length === 0) return row;
  const pointsOf = (fare: Data) => count(first(fare, ["miles", "points", "award_miles", "miles_required"])) ?? Infinity;
  const inCabin = cabin ? fares.filter((fare) => text(fare.cabin)?.toLowerCase() === cabin) : [];
  const pool = inCabin.length > 0 ? inCabin : fares;
  return [...pool].sort((a, b) => pointsOf(a) - pointsOf(b))[0] ?? null;
}
