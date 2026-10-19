import { describe, expect, it } from "vitest";
import type { FlightOption, TripScope } from "../../src/shared/flights.ts";
import { bestPick, bestValue, centsPerPoint, lineUp, rank } from "../../src/shared/rank.ts";

let next = 0;
function flight(parts: Partial<FlightOption> & { price: FlightOption["price"] }): FlightOption {
  next += 1;
  return {
    id: `f${next}`,
    source: { key: parts.price.kind === "cash" ? "google_flights" : "delta", label: "Site", url: null },
    carrier: "Delta",
    carrierCode: "DL",
    flightNumbers: [],
    origin: "SFO",
    destination: "JFK",
    departTime: "6:05 AM",
    arriveTime: "4:48 PM",
    departMinutes: 365,
    arriveMinutes: 1008,
    durationMinutes: 463,
    stops: 1,
    via: ["MSP"],
    ...parts,
  };
}
const usd = (amountMinor: number, scope: TripScope = "one_way") => ({ kind: "cash" as const, amountMinor, currency: "USD", scope });
const miles = (points: number, program = "delta", scope: TripScope = "one_way", taxesMinor: number | null = 560) => ({
  kind: "award" as const,
  program,
  points,
  taxesMinor,
  taxesCurrency: taxesMinor === null ? null : "USD",
  scope,
});

describe("lineUp", () => {
  it("puts the same flight's cash fare and award prices on one row", () => {
    const rows = lineUp([flight({ price: usd(19600) }), flight({ price: miles(14500) }), flight({ price: miles(20000, "american") })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cash?.amountMinor).toBe(19600);
    expect(rows[0]?.awards.map((award) => award.program)).toEqual(["delta", "american"]);
    expect(rows[0]?.centsPerPoint).toEqual([
      { program: "delta", cents: 1.31 },
      { program: "american", cents: 0.95 },
    ]);
  });

  it("keeps different flights apart: another time, another airline, other flight numbers", () => {
    expect(lineUp([flight({ price: usd(19600) }), flight({ price: miles(14500), departMinutes: 366 })])).toHaveLength(2);
    expect(lineUp([flight({ price: usd(19600) }), flight({ price: miles(14500), carrierCode: "AA" })])).toHaveLength(2);
    expect(
      lineUp([flight({ price: usd(19000), flightNumbers: ["DL1"] }), flight({ price: miles(9000), flightNumbers: ["DL2"] })]),
    ).toHaveLength(2);
    // Flight numbers on one side only don't keep a match apart.
    expect(lineUp([flight({ price: usd(19000) }), flight({ price: miles(9000), flightNumbers: ["DL2"] })])).toHaveLength(1);
  });

  it("never joins a flight to a row it contradicts", () => {
    const rows = lineUp([
      flight({ price: usd(19600) }),
      flight({ price: usd(19000), flightNumbers: ["DL1"] }),
      flight({ price: miles(9000), flightNumbers: ["DL2"] }),
    ]);
    const joined = rows.find((row) => row.cash?.amountMinor === 19000 && row.awards.some((award) => award.points === 9000));
    expect(joined).toBeUndefined();
  });

  it("matches arrivals by clock time, since some sites don't print the arrival day", () => {
    const rows = lineUp([
      flight({ price: usd(28400), departMinutes: 1439, arriveMinutes: 505 }),
      flight({ price: miles(25000), departMinutes: 1439, arriveMinutes: 505 + 1440 }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("never merges flights it can't identify", () => {
    const rows = lineUp([flight({ price: usd(100), carrierCode: null }), flight({ price: miles(1000), carrierCode: null })]);
    expect(rows).toHaveLength(2);
  });

  it("keeps a program's fewest points and the site's lowest fare", () => {
    const rows = lineUp([flight({ price: usd(20000) }), flight({ price: usd(19000) }), flight({ price: miles(30000) }), flight({ price: miles(25000) })]);
    expect(rows[0]?.cash?.amountMinor).toBe(19000);
    expect(rows[0]?.awards).toHaveLength(1);
    expect(rows[0]?.awards[0]?.points).toBe(25000);
  });
});

describe("centsPerPoint", () => {
  it("only compares prices for the same trip, with known taxes in the fare's currency", () => {
    expect(centsPerPoint(usd(19600), miles(14500))).toBe(1.31);
    expect(centsPerPoint(usd(39000, "round_trip"), miles(14500, "delta", "outbound_only"))).toBeNull();
    expect(centsPerPoint(usd(19600), miles(14500, "delta", "one_way", null))).toBeNull();
    expect(centsPerPoint({ ...usd(19600), currency: "EUR" }, miles(14500))).toBeNull();
    expect(centsPerPoint(usd(500), miles(14500, "delta", "one_way", 560))).toBeNull();
  });
});

describe("rank", () => {
  it("puts cash fares first, lowest first, then award-only rows by fewest points", () => {
    const rows = rank(
      lineUp([
        flight({ price: miles(9000), departMinutes: 600, arriveMinutes: 1100 }),
        flight({ price: usd(25000), departMinutes: 700, arriveMinutes: 1200 }),
        flight({ price: usd(19600) }),
        flight({ price: miles(7000), departMinutes: 800, arriveMinutes: 1300 }),
      ]),
    );
    expect(rows.map((row) => row.cash?.amountMinor ?? row.awards[0]?.points)).toEqual([19600, 25000, 7000, 9000]);
    expect(bestPick(rows)?.cash?.amountMinor).toBe(19600);
  });

  it("breaks ties with fewer stops, then shorter flights, then earlier departures", () => {
    const rows = rank(
      lineUp([
        flight({ price: usd(20000), stops: 1, departMinutes: 100, arriveMinutes: 500 }),
        flight({ price: usd(20000), stops: 0, durationMinutes: 400, departMinutes: 200, arriveMinutes: 600 }),
        flight({ price: usd(20000), stops: 0, durationMinutes: 330, departMinutes: 300, arriveMinutes: 630 }),
        flight({ price: usd(20000), stops: 0, durationMinutes: 330, departMinutes: 250, arriveMinutes: 580 }),
      ]),
    );
    expect(rows.map((row) => row.flight.departMinutes)).toEqual([250, 300, 200, 100]);
  });

  it("picks the fewest points when no site found a cash fare", () => {
    const rows = rank(lineUp([flight({ price: miles(30000), departMinutes: 1 }), flight({ price: miles(12000), departMinutes: 2 })]));
    expect(bestPick(rows)?.awards[0]?.points).toBe(12000);
    expect(bestPick([])).toBeNull();
  });
});

describe("bestValue", () => {
  it("names the row and program whose points go furthest", () => {
    const rows = rank(
      lineUp([
        flight({ price: usd(19600) }),
        flight({ price: miles(14500) }),
        flight({ price: usd(20900), carrierCode: "AA", carrier: "American" }),
        flight({ price: miles(12500, "american"), carrierCode: "AA", carrier: "American" }),
      ]),
    );
    expect(bestValue(rows)).toMatchObject({ program: "american", cents: 1.63 });
    expect(bestValue(rank(lineUp([flight({ price: usd(100) })])))).toBeNull();
  });
});
