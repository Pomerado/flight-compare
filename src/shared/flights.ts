/**
 * One shape for every site's flights, so cash fares and award prices line up.
 *
 * Each normalizer reads its tool's output_schema from Pomerado's catalog (GET /v1/tools/{id}).
 * What the schemas say about prices:
 * - Google Flights fares (`price_minor`, `fare_minor`) are totals for all searched passengers.
 * - Award miles and taxes are per passenger on every award tool, so they are multiplied by the
 *   passenger count here. Both sides of a row are then totals for the whole party.
 * - Round-trip searches list outbound flights with a starting price for the whole round trip.
 *   No return flight is picked. American states its price scope on each row.
 */

export type TripScope = "one_way" | "round_trip" | "outbound_only";

export type CashPrice = {
  kind: "cash";
  /** Total for all passengers. */
  amountMinor: number;
  currency: string;
  scope: TripScope;
};

export type AwardPrice = {
  kind: "award";
  /** The program, keyed into COPY.programs. */
  program: string;
  /** Total for all passengers. */
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
  /** The first airline's two-letter code, when known. */
  carrierCode: string | null;
  flightNumbers: string[];
  origin: string | null;
  destination: string | null;
  /** "7:00 AM", or "8:25 AM+1" for the next day. */
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

export type Cabin = "economy" | "premium_economy" | "business" | "first";

export type NormalizeContext = {
  key: string;
  label: string;
  /** Passengers searched, to turn per-passenger award prices into totals. */
  adults: number;
  cabin: Cabin;
};

type Data = Record<string, unknown>;

const record = (value: unknown): Data | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Data) : null;
const records = (value: unknown): Data[] =>
  Array.isArray(value) ? value.flatMap((item) => (record(item) ? [item as Data] : [])) : [];
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const texts = (value: unknown) => (Array.isArray(value) ? value.flatMap((item) => (text(item) ? [text(item)!] : [])) : []);
const httpsUrl = (value: unknown) => {
  const found = text(value);
  return found && /^https:\/\//i.test(found) ? found : null;
};

/** The names flight sites show, with their codes. The first name per code is its display name. */
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

const carrierName = (code: string | null) => (code ? (AIRLINE_CODES.find(([, known]) => known === code)?.[0] ?? code) : null);

/** "DL 123", "dl0123" -> DL123; "123" with a default carrier -> DL123. */
export function flightNumber(value: string, defaultCarrier: string | null = null): string | null {
  const match = /^([A-Z0-9]{2})?\s*0*(\d{1,4})$/i.exec(value.trim());
  if (!match) return null;
  const carrier = match[1]?.toUpperCase() ?? defaultCarrier;
  return carrier ? `${carrier}${match[2]}` : null;
}

const flightNumbers = (values: string[], defaultCarrier: string | null) =>
  values.flatMap((value) => {
    const found = flightNumber(value, defaultCarrier);
    return found ? [found] : [];
  });

/**
 * "7:00 AM" -> 420, "8:25 AM+1" -> 1945, "19:05" -> 1145, "7:00pm" -> 1140,
 * "2026-11-09T07:00" -> 420. `dayShift` adds whole days for a later arrival day.
 */
export function minutesOf(value: string | null, dayShift = 0): number | null {
  if (value === null) return null;
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(value);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]) + dayShift * 1440;
  const match = /^(\d{1,2}):(\d{2})\s*(?:([ap])\.?\s*m?\.?)?\s*(?:\+\s*(\d))?/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "p" && hours < 12) hours += 12;
  if (meridiem === "a" && hours === 12) hours = 0;
  if (hours > 23 || Number(match[2]) > 59) return null;
  const plus = match[4] ? Number(match[4]) : 0;
  return hours * 60 + Number(match[2]) + (plus + dayShift) * 1440;
}

/** 1945 -> "8:25 AM+1": every site's times read the same way. */
export function clockText(minutes: number | null): string | null {
  if (minutes === null) return null;
  const days = Math.floor(minutes / 1440);
  const inDay = minutes % 1440;
  const hours = Math.floor(inDay / 60);
  const clock = `${((hours + 11) % 12) + 1}:${String(inDay % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return days > 0 ? `${clock}+${days}` : clock;
}

/** Whole days between two YYYY-MM-DD dates, else 0. */
function daysBetween(from: unknown, to: unknown) {
  const a = text(from);
  const b = text(to);
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return 0;
  const days = Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** A later-day label such as "+1 day" -> 1; any other label means the next day. */
function dayLabel(value: unknown) {
  const label = text(value);
  if (label === null) return 0;
  const plus = /\+\s*(\d)/.exec(label);
  return plus ? Number(plus[1]) : 1;
}

/** Airport codes in a display string: "1 stop · 1 hr 5 min ORD" -> ["ORD"]. */
const airportCodes = (value: unknown) => (text(value)?.match(/\b[A-Z]{3}\b/g) ?? []);

/** A currency symbol or code as printed -> its ISO code, when it is unambiguous for a US search. */
export function currencyOf(value: unknown): string | null {
  const shown = text(value);
  if (shown === null) return null;
  if (/^[A-Z]{3}$/.test(shown)) return shown;
  // The award sites search their US market, where "$" is US dollars.
  return ({ $: "USD", US$: "USD", "€": "EUR", "£": "GBP", C$: "CAD", CA$: "CAD" } as Record<string, string>)[shown] ?? null;
}

/** Taxes printed in major units (5.6) -> minor units (560). */
const minorOf = (amount: number | null) => (amount === null ? null : Math.round(amount * 100));

type Times = { depart: number | null; arrive: number | null };

function flight(
  context: NormalizeContext,
  index: number,
  url: string | null,
  parts: {
    carrier: string | null;
    carrierCode: string | null;
    flightNumbers: string[];
    origin: unknown;
    destination: unknown;
    times: Times;
    duration: unknown;
    stops: unknown;
    via: string[];
  },
  price: CashPrice | AwardPrice,
): FlightOption {
  return {
    id: `${context.key}-${index}`,
    source: { key: context.key, label: context.label, url },
    carrier: parts.carrier,
    carrierCode: parts.carrierCode,
    flightNumbers: parts.flightNumbers,
    origin: text(parts.origin),
    destination: text(parts.destination),
    departTime: clockText(parts.times.depart),
    arriveTime: clockText(parts.times.arrive),
    departMinutes: parts.times.depart,
    arriveMinutes: parts.times.arrive,
    durationMinutes: count(parts.duration),
    stops: count(parts.stops),
    via: parts.via,
    price,
  };
}

/** An award price for the party, from per-passenger miles and taxes. */
function award(
  program: string,
  context: NormalizeContext,
  scope: TripScope,
  perPassenger: { miles: number | null; taxesMinor: number | null; currency: string | null },
): AwardPrice | null {
  if (perPassenger.miles === null || perPassenger.miles <= 0) return null;
  const taxes = perPassenger.taxesMinor;
  return {
    kind: "award",
    program,
    points: perPassenger.miles * context.adults,
    taxesMinor: taxes === null ? null : taxes * context.adults,
    taxesCurrency: taxes === null ? null : perPassenger.currency,
    scope,
  };
}

/** Google Flights one-way search. `price_minor` is the fare for the whole party. */
export function normalizeGoogleFlights(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.search_url);
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const amount = count(row.price_minor);
    if (amount === null || amount <= 0) return [];
    const carrier = text(row.airline);
    const arrival = text(row.arrival_time);
    // arrival_time carries the next-day "+1"; the dates cover arrivals without it.
    const shift = /\+\s*\d/.test(arrival ?? "") ? 0 : daysBetween(row.departure_date, row.arrival_date);
    return [
      flight(
        context,
        index,
        url,
        {
          carrier,
          carrierCode: carrierCode(carrier),
          flightNumbers: [],
          origin: row.origin_airport,
          destination: row.destination_airport,
          times: { depart: minutesOf(text(row.departure_time)), arrive: minutesOf(arrival, shift) },
          duration: row.duration_minutes,
          stops: row.stops,
          via: records(row.connections).flatMap((connection) => (text(connection.airport) ? [text(connection.airport)!] : [])),
        },
        { kind: "cash", amountMinor: amount, currency: text(row.currency) ?? "USD", scope: "one_way" },
      ),
    ];
  });
}

/**
 * Google Flights round trip: outbound flights with a starting round-trip fare for the whole
 * party (`fare_minor`), the currency once for the result, and no return flight picked.
 */
export function normalizeGoogleFlightsRoundTrip(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.search_url);
  const currency = text(data.currency) ?? "USD";
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const amount = count(row.fare_minor);
    if (amount === null || amount <= 0) return [];
    const carrier = text(row.airlines);
    return [
      flight(
        context,
        index,
        url,
        {
          carrier,
          carrierCode: carrierCode(carrier),
          flightNumbers: [],
          origin: row.origin_airport,
          destination: row.destination_airport,
          times: { depart: minutesOf(text(row.departure_time)), arrive: minutesOf(text(row.arrival_time)) },
          duration: row.duration_minutes,
          stops: row.stops,
          via: airportCodes(row.layovers),
        },
        { kind: "cash", amountMinor: amount, currency, scope: "round_trip" },
      ),
    ];
  });
}

/** Carrier and flight numbers from segments' marketing flight numbers. */
function fromSegments(segments: Data[], siteCarrier: string) {
  const numbers = flightNumbers(
    segments.flatMap((segment) => (text(segment.flight_number) ? [text(segment.flight_number)!] : [])),
    siteCarrier,
  );
  const code = numbers[0]?.slice(0, 2) ?? siteCarrier;
  return { carrierCode: code, carrier: carrierName(code), flightNumbers: numbers };
}

/**
 * American one-way awards: the asked cabin's fare per row (`fare`), miles and taxes per
 * passenger, taxes in major units beside a currency symbol, and local date-times.
 */
export function normalizeAmericanOneWay(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.results_url);
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const fare = record(row.fare);
    if (!fare || fare.available === false) return [];
    const price = award("american", context, "one_way", {
      miles: count(fare.miles_per_passenger),
      taxesMinor: minorOf(count(fare.taxes_and_fees_amount)),
      currency: currencyOf(fare.taxes_and_fees_currency_symbol),
    });
    if (!price) return [];
    const departure = text(row.departure_local_datetime);
    return [
      flight(
        context,
        index,
        url,
        {
          ...fromSegments(records(row.segments), "AA"),
          origin: row.origin_airport,
          destination: row.destination_airport,
          times: {
            depart: minutesOf(departure),
            arrive: minutesOf(text(row.arrival_local_datetime), daysBetween(departure, row.arrival_local_datetime)),
          },
          duration: row.duration_minutes,
          stops: row.stops,
          via: texts(row.connection_airports).flatMap((value) => airportCodes(value)),
        },
        price,
      ),
    ];
  });
}

/**
 * American round-trip awards: outbound rows, miles per passenger for the row's own price scope
 * (`price_scope`, such as "Round trip"). A one-way scope is labelled outbound only.
 */
export function normalizeAmericanRoundTrip(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const scope: TripScope = /one[\s-]?way/i.test(text(row.price_scope) ?? "") ? "outbound_only" : "round_trip";
    const price = award("american", context, scope, {
      miles: count(row.miles),
      taxesMinor: minorOf(count(row.taxes_amount)),
      currency: currencyOf(row.currency_symbol),
    });
    if (!price) return [];
    return [
      flight(
        context,
        index,
        // This tool's result carries no results page.
        null,
        {
          ...fromSegments(records(row.segments), "AA"),
          origin: row.origin,
          destination: row.destination,
          times: {
            depart: minutesOf(text(row.departure_time_24h)),
            arrive: minutesOf(text(row.arrival_time_24h), count(row.arrival_day_offset) ?? 0),
          },
          duration: row.duration_minutes,
          stops: row.stops,
          via: texts(row.connections).flatMap((value) => airportCodes(value).slice(0, 1)),
        },
        price,
      ),
    ];
  });
}

/** Which of a site's fare labels is the asked cabin. */
const CABIN_LABELS: Record<Cabin, RegExp> = {
  economy: /\b(main|economy)\b/i,
  premium_economy: /premium/i,
  business: /\b(business|delta one|polaris)\b/i,
  first: /\bfirst\b/i,
};

function pickFare(fares: Data[], cabin: Cabin, label: string, miles: string): Data | null {
  const available = fares.filter((fare) => fare.available !== false && count(fare[miles]) !== null);
  // "Premium economy" also says economy, so economy skips labels that name premium.
  const matches = available.filter((fare) => {
    const name = text(fare[label]) ?? "";
    return CABIN_LABELS[cabin].test(name) && !(cabin === "economy" && /premium|basic/i.test(name));
  });
  const pool = matches.length > 0 ? matches : available;
  return [...pool].sort((a, b) => count(a[miles])! - count(b[miles])!)[0] ?? null;
}

function deltaParts(row: Data) {
  const numbers = flightNumbers(texts(row.flight_numbers), "DL");
  const code = numbers[0]?.slice(0, 2) ?? "DL";
  return {
    carrierCode: code,
    carrier: carrierName(code),
    flightNumbers: numbers,
    origin: row.origin,
    destination: row.destination,
    times: { depart: minutesOf(text(row.departure_time)), arrive: minutesOf(text(row.arrival_time), dayLabel(row.arrival_day)) },
    duration: row.duration_minutes,
    stops: row.stops,
    via: texts(row.connection_airports),
  };
}

/**
 * Delta one-way awards: each card's fares (`fares`), SkyMiles and taxes per passenger, taxes in
 * minor units with an ISO currency. The fare in the asked cabin, else the card's fewest miles.
 */
export function normalizeDeltaOneWay(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.results_url);
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const fare = pickFare(records(row.fares), context.cabin, "cabin", "miles");
    if (!fare) return [];
    const price = award("delta", context, "one_way", {
      miles: count(fare.miles),
      taxesMinor: count(fare.taxes_minor),
      currency: text(fare.currency),
    });
    return price ? [flight(context, index, url, deltaParts(row), price)] : [];
  });
}

/**
 * Delta round-trip awards: outbound options quoted as round-trip-from miles and cash per
 * passenger (`miles`, `cash_minor`). Not a one-way quote.
 */
export function normalizeDeltaRoundTrip(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.results_url);
  return records(data.flights).flatMap((row, index): FlightOption[] => {
    const price = award("delta", context, "round_trip", {
      miles: count(row.miles),
      taxesMinor: count(row.cash_minor),
      currency: text(row.currency),
    });
    return price ? [flight(context, index, url, deltaParts(row), price)] : [];
  });
}

/**
 * United one-way awards: every displayed fare column (`award_fares`), miles and taxes per
 * person, taxes in major units beside a symbol or code. The column for the asked cabin, else the
 * row's fewest miles.
 */
export function normalizeUnited(result: unknown, context: NormalizeContext): FlightOption[] {
  const data = record(result);
  if (!data) return [];
  const url = httpsUrl(data.results_url);
  return records(data.itineraries).flatMap((row, index): FlightOption[] => {
    const fare = pickFare(records(row.award_fares), context.cabin, "column", "miles_per_person");
    if (!fare) return [];
    const price = award("united", context, "one_way", {
      miles: count(fare.miles_per_person),
      taxesMinor: minorOf(count(fare.taxes_fees_per_person)),
      currency: currencyOf(fare.currency),
    });
    if (!price) return [];
    const segments = records(row.segments);
    const advisories = segments.flatMap((segment) => texts(segment.advisories)).join(" ");
    const nextDay = text(row.arrival_date_note) ?? (/arrives?.*(next day|\+\d)/i.test(advisories) ? advisories : null);
    return [
      flight(
        context,
        index,
        url,
        {
          ...fromSegments(segments, "UA"),
          origin: row.origin,
          destination: row.destination,
          times: { depart: minutesOf(text(row.departure_time)), arrive: minutesOf(text(row.arrival_time), dayLabel(nextDay)) },
          duration: row.duration_minutes,
          stops: row.stops,
          via: texts(row.connection_airports),
        },
        price,
      ),
    ];
  });
}
