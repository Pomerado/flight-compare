import type { FieldOptions, InputSchema } from "pomerado-app-kit/shared";
import { COPY } from "./copy.js";
import { normalizeAward, normalizeGoogleFlights, type FlightOption } from "./flights.js";
import type { SiteTool } from "./tools.js";

/**
 * Flight Compare's recipe: what it asks, which runs it fans out, and how each site's result
 * becomes flights.
 */

export const CABINS = ["economy", "premium_economy", "business", "first"] as const;

/** The ask, written as an input_schema so the kit builds the form. */
export const ASK_SCHEMA: InputSchema = {
  type: "object",
  required: ["origin", "destination", "departure_date", "cabin", "adults"],
  properties: {
    origin: { title: COPY.ask.origin, type: "string", pattern: "^[A-Za-z]{3}$", maxLength: 3, examples: ["SFO"] },
    destination: { title: COPY.ask.destination, type: "string", pattern: "^[A-Za-z]{3}$", maxLength: 3, examples: ["JFK"] },
    departure_date: { title: COPY.ask.departure, type: "string", format: "date" },
    return_date: { title: COPY.ask.return, type: "string", format: "date" },
    cabin: { title: COPY.ask.cabin, type: "string", enum: CABINS, default: "economy" },
    adults: { title: COPY.ask.passengers, type: "integer", minimum: 1, maximum: 9, default: 1 },
  },
};

export const ASK_LAYOUT = [
  ["origin", "destination"],
  ["departure_date", "return_date"],
  ["cabin", "adults"],
];

export function askFieldOptions(today: string): FieldOptions {
  return {
    optionLabels: COPY.ask.cabins,
    patternMessages: { origin: COPY.ask.airportHint, destination: COPY.ask.airportHint },
    minDates: { departure_date: today, return_date: today },
  };
}

export type Ask = {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  cabin: (typeof CABINS)[number];
  adults: number;
};

/** The checks a schema can't say: two different airports, and a return on or after departure. */
export function askIssues(input: Record<string, unknown>): Record<string, string> {
  const issues: Record<string, string> = {};
  if (String(input.origin).toUpperCase() === String(input.destination).toUpperCase()) {
    issues.destination = COPY.ask.sameAirport;
  }
  if (typeof input.return_date === "string" && input.return_date < String(input.departure_date)) {
    issues.return_date = COPY.ask.returnBeforeDeparture;
  }
  return issues;
}

export function toAsk(input: Record<string, unknown>): Ask {
  return {
    origin: String(input.origin).toUpperCase(),
    destination: String(input.destination).toUpperCase(),
    departure_date: String(input.departure_date),
    ...(typeof input.return_date === "string" ? { return_date: input.return_date } : {}),
    cabin: input.cabin as Ask["cabin"],
    adults: Number(input.adults),
  };
}

/** The run each site gets: its round-trip tool when there's a return date, else its one-way tool. */
export function runFor(site: SiteTool, ask: Ask, timeoutOverrideMs: number | null) {
  const roundTrip = ask.return_date !== undefined;
  const input: Record<string, unknown> = {
    origin: ask.origin,
    destination: ask.destination,
    departure_date: ask.departure_date,
    adults: ask.adults,
    cabin: ask.cabin,
    ...(roundTrip ? { return_date: ask.return_date } : {}),
  };
  return {
    key: site.alias,
    label: site.label,
    toolId: roundTrip ? site.roundTrip : site.oneWay,
    input,
    timeoutMs: timeoutOverrideMs ?? site.timeoutSeconds * 1000,
  };
}

/** A site's result pages as flights. */
export function flightsFrom(site: SiteTool, pages: unknown[], ask: Ask): FlightOption[] {
  const roundTrip = ask.return_date !== undefined;
  return pages.flatMap((page, pageIndex) => {
    const context = { key: `${site.alias}-${pageIndex}`, label: site.label, scope: roundTrip ? site.roundTripScope : "one_way" } as const;
    const flights =
      site.kind === "cash"
        ? normalizeGoogleFlights(page, context)
        : normalizeAward(page, { ...context, program: site.program ?? site.alias, cabin: ask.cabin });
    // Keep the source's key the site's own, so links and labels don't depend on the page.
    return flights.map((flight) => ({ ...flight, source: { ...flight.source, key: site.alias } }));
  });
}
