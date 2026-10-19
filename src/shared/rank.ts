import type { AwardPrice, CashPrice, FlightOption, Source } from "./flights.js";

/**
 * Lining up and ranking, with one visible rule and no hidden scoring:
 * - The same flight from several sites becomes one row, its cash fare and award prices side by side.
 * - Rows with a cash fare come first, lowest fare first. Rows with only award prices follow,
 *   fewest points first. Ties go to fewer stops, then shorter flights, then earlier departures.
 * - Cents per point shows only when a row has a cash fare and an award price for the same trip
 *   (both one-way), with taxes in the fare's currency.
 */

export type RowCash = CashPrice & { source: Source };
export type RowAward = AwardPrice & { source: Source };

export type FlightRow = {
  key: string;
  /** The flight's times, airline and stops, from its cash row when it has one. */
  flight: FlightOption;
  cash: RowCash | null;
  /** One price per program, its fewest points. */
  awards: RowAward[];
  /** Per program, what a point is worth against this row's cash fare. */
  centsPerPoint: { program: string; cents: number }[];
};

/** Rows are the same flight when airline, departure and arrival match, and flight numbers don't differ. */
function sameFlight(a: FlightOption, b: FlightOption) {
  if (a.carrierCode === null || a.departMinutes === null || a.arriveMinutes === null) return false;
  if (a.carrierCode !== b.carrierCode || a.departMinutes !== b.departMinutes || a.arriveMinutes !== b.arriveMinutes) {
    return false;
  }
  if (a.flightNumbers.length > 0 && b.flightNumbers.length > 0) {
    return a.flightNumbers.join(",") === b.flightNumbers.join(",");
  }
  return true;
}

/** What a point is worth against a cash fare, in cents, or null when the two don't compare. */
export function centsPerPoint(cash: CashPrice, award: AwardPrice): number | null {
  if (cash.scope !== "one_way" || award.scope !== "one_way") return null;
  if (award.taxesMinor === null || award.taxesCurrency !== cash.currency) return null;
  const cents = (cash.amountMinor - award.taxesMinor) / award.points;
  return cents > 0 ? Math.round(cents * 100) / 100 : null;
}

export function lineUp(options: FlightOption[]): FlightRow[] {
  const groups: FlightOption[][] = [];
  for (const option of options) {
    // A flight joins a row only when it matches every flight already on it.
    const group = groups.find((members) => members.every((member) => sameFlight(member, option)));
    if (group) group.push(option);
    else groups.push([option]);
  }
  return groups.map((members) => {
    const cashOptions = members.filter((member) => member.price.kind === "cash");
    const cheapest = [...cashOptions].sort(
      (a, b) => (a.price as CashPrice).amountMinor - (b.price as CashPrice).amountMinor,
    )[0];
    const cash: RowCash | null = cheapest ? { ...(cheapest.price as CashPrice), source: cheapest.source } : null;
    const byProgram = new Map<string, RowAward>();
    for (const member of members) {
      if (member.price.kind !== "award") continue;
      const known = byProgram.get(member.price.program);
      if (!known || member.price.points < known.points) {
        byProgram.set(member.price.program, { ...member.price, source: member.source });
      }
    }
    const awards = [...byProgram.values()].sort((a, b) => a.points - b.points);
    const flight = cheapest ?? members[0]!;
    return {
      key: members.map((member) => member.id).join("+"),
      flight,
      cash,
      awards,
      centsPerPoint: cash
        ? awards.flatMap((award) => {
            const cents = centsPerPoint(cash, award);
            return cents === null ? [] : [{ program: award.program, cents }];
          })
        : [],
    };
  });
}

const fewestPoints = (row: FlightRow) => (row.awards.length > 0 ? Math.min(...row.awards.map((award) => award.points)) : Infinity);
const orNever = (value: number | null) => value ?? Infinity;

export function rank(rows: FlightRow[]): FlightRow[] {
  return [...rows].sort((a, b) => {
    if ((a.cash === null) !== (b.cash === null)) return a.cash === null ? 1 : -1;
    const price =
      a.cash && b.cash
        ? a.cash.currency === b.cash.currency
          ? a.cash.amountMinor - b.cash.amountMinor
          : a.cash.currency.localeCompare(b.cash.currency)
        : fewestPoints(a) - fewestPoints(b);
    if (price !== 0 && !Number.isNaN(price)) return price;
    return (
      orNever(a.flight.stops) - orNever(b.flight.stops) ||
      orNever(a.flight.durationMinutes) - orNever(b.flight.durationMinutes) ||
      orNever(a.flight.departMinutes) - orNever(b.flight.departMinutes)
    );
  });
}

/** The best pick: the lowest cash fare, else the fewest points. Rows must be ranked. */
export function bestPick(ranked: FlightRow[]): FlightRow | null {
  return ranked[0] ?? null;
}

/** The row whose points go furthest against its own cash fare, when any row has both. */
export function bestValue(ranked: FlightRow[]): { row: FlightRow; program: string; cents: number } | null {
  let best: { row: FlightRow; program: string; cents: number } | null = null;
  for (const row of ranked) {
    for (const value of row.centsPerPoint) {
      if (!best || value.cents > best.cents) best = { row, program: value.program, cents: value.cents };
    }
  }
  return best;
}
