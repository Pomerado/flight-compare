import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carrierCode,
  currencyOf,
  minutesOf,
  normalizeAmericanOneWay,
  normalizeAmericanRoundTrip,
  normalizeDeltaOneWay,
  normalizeDeltaRoundTrip,
  normalizeGoogleFlights,
  normalizeGoogleFlightsRoundTrip,
  normalizeUnited,
  type NormalizeContext,
} from "../../src/shared/flights.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const context = (key: string, adults = 1, cabin: NormalizeContext["cabin"] = "economy"): NormalizeContext => ({
  key,
  label: key,
  adults,
  cabin,
});

describe("Google Flights", () => {
  it("reads each one-way flight with its times, stops, fare for the party and search link", () => {
    const flights = normalizeGoogleFlights(fixture("google-flights.json"), context("google"));
    expect(flights).toHaveLength(6);
    expect(flights.find((flight) => flight.departTime === "6:05 AM")).toMatchObject({
      carrier: "Delta",
      carrierCode: "DL",
      origin: "SFO",
      destination: "JFK",
      arriveTime: "4:48 PM",
      departMinutes: 365,
      arriveMinutes: 1008,
      durationMinutes: 463,
      stops: 1,
      via: ["MSP"],
      price: { kind: "cash", amountMinor: 19600, currency: "USD", scope: "one_way" },
      source: { url: expect.stringMatching(/^https:\/\/www\.google\.com\/travel\/flights/) },
    });
  });

  it("keeps a next-day arrival's day, from the +1 or from the dates", () => {
    const late = normalizeGoogleFlights(fixture("google-flights.json"), context("google")).find((flight) => flight.departTime === "11:59 PM")!;
    expect(late.arriveTime).toBe("8:25 AM+1");
    const dated = {
      flights: [{ airline: "Delta", departure_time: "11:59 PM", arrival_time: "8:25 AM", departure_date: "2026-12-08", arrival_date: "2026-12-09", price_minor: 100 }],
    };
    expect(normalizeGoogleFlights(dated, context("google"))[0]?.arriveMinutes).toBe(8 * 60 + 25 + 1440);
  });

  it("reads the round trip's outbound flights, layover airports and starting round-trip fare", () => {
    const flights = normalizeGoogleFlightsRoundTrip(fixture("google-flights-round-trip.json"), context("google"));
    expect(flights).toHaveLength(4);
    expect(flights[1]).toMatchObject({
      carrier: "Delta",
      carrierCode: "DL",
      via: ["MSP"],
      price: { kind: "cash", amountMinor: 37900, currency: "USD", scope: "round_trip" },
    });
    expect(flights[3]?.arriveTime).toBe("8:25 AM+1");
  });

  it("leaves out unpriced flights and anything that isn't a result, and links only to https pages", () => {
    expect(normalizeGoogleFlights({ flights: [{ airline: "Alaska", price_minor: null }, "junk"] }, context("google"))).toEqual([]);
    expect(normalizeGoogleFlights(null, context("google"))).toEqual([]);
    expect(normalizeGoogleFlightsRoundTrip({ flights: "none" }, context("google"))).toEqual([]);
    const unsafe = { search_url: "javascript:alert(1)", flights: [{ airline: "Delta", price_minor: 100 }] };
    expect(normalizeGoogleFlights(unsafe, context("google"))[0]?.source.url).toBeNull();
  });
});

describe("American awards", () => {
  it("reads per-passenger miles and taxes as totals for the party", () => {
    const flights = normalizeAmericanOneWay(fixture("american-award.json"), context("american", 2));
    // The third row's Main Cabin fare is unavailable, so it's left out.
    expect(flights).toHaveLength(2);
    expect(flights[0]).toMatchObject({
      carrier: "American",
      carrierCode: "AA",
      flightNumbers: ["AA2311", "AA1544"],
      departTime: "1:45 PM",
      arriveTime: "11:58 PM",
      via: ["ORD"],
      price: { kind: "award", program: "american", points: 25000, taxesMinor: 1120, taxesCurrency: "USD", scope: "one_way" },
      source: { url: "https://www.aa.com/booking/choose-flights/1" },
    });
  });

  it("labels a round-trip row by its own price scope", () => {
    const flights = normalizeAmericanRoundTrip(fixture("american-award-round-trip.json"), context("american"));
    expect(flights.map((flight) => flight.price)).toEqual([
      expect.objectContaining({ points: 25000, taxesMinor: 1120, scope: "round_trip" }),
      expect.objectContaining({ points: 45000, scope: "round_trip" }),
    ]);
    expect(flights[0]?.via).toEqual(["ORD"]);
    const oneWay = { flights: [{ ...(fixture("american-award-round-trip.json") as { flights: object[] }).flights[0], price_scope: "One way" }] };
    expect(normalizeAmericanRoundTrip(oneWay, context("american"))[0]?.price.scope).toBe("outbound_only");
  });
});

describe("Delta awards", () => {
  it("takes the fare in the asked cabin, per passenger times passengers", () => {
    const economy = normalizeDeltaOneWay(fixture("delta-award.json"), context("delta", 2));
    expect(economy).toHaveLength(3);
    expect(economy[0]).toMatchObject({
      carrierCode: "DL",
      carrier: "Delta",
      flightNumbers: ["DL1102", "DL2210"],
      departTime: "6:05 AM",
      price: { kind: "award", program: "delta", points: 29000, taxesMinor: 1120, taxesCurrency: "USD" },
    });
    const first = normalizeDeltaOneWay(fixture("delta-award.json"), context("delta", 1, "first"));
    expect(first[0]?.price).toMatchObject({ points: 52000 });
    // A card without the asked cabin falls back to its fewest miles.
    expect(first[2]?.price).toMatchObject({ points: 18000 });
    const business = normalizeDeltaOneWay(fixture("delta-award.json"), context("delta", 1, "business"));
    expect(business[1]?.price).toMatchObject({ points: 90000 });
  });

  it("marks a later arrival day from the card's label", () => {
    const late = normalizeDeltaOneWay(fixture("delta-award.json"), context("delta"))[1]!;
    expect(late.arriveTime).toBe("8:25 AM+1");
    expect(late.arriveMinutes).toBe(8 * 60 + 25 + 1440);
  });

  it("reads round-trip-from miles and cash as a round-trip price", () => {
    const flights = normalizeDeltaRoundTrip(fixture("delta-award-round-trip.json"), context("delta"));
    expect(flights[0]?.price).toEqual({
      kind: "award",
      program: "delta",
      points: 29000,
      taxesMinor: 1120,
      taxesCurrency: "USD",
      scope: "round_trip",
    });
  });
});

describe("United awards", () => {
  it("takes the asked cabin's column and skips unavailable ones", () => {
    const flights = normalizeUnited(fixture("united-award.json"), context("united"));
    expect(flights[0]).toMatchObject({
      carrierCode: "UA",
      flightNumbers: ["UA1234"],
      price: { points: 17500, taxesMinor: 560, taxesCurrency: "USD", scope: "one_way" },
    });
    expect(normalizeUnited(fixture("united-award.json"), context("united", 1, "business"))[0]?.price).toMatchObject({ points: 60000 });
    expect(normalizeUnited(fixture("united-award.json"), context("united", 1, "premium_economy"))[0]?.price).toMatchObject({ points: 35000 });
    expect(flights[1]?.arriveTime).toBe("7:10 AM+1");
  });
});

describe("times, carriers and currencies", () => {
  it("reads the clock formats sites use", () => {
    expect(minutesOf("7:00 AM")).toBe(420);
    expect(minutesOf("12:15 AM")).toBe(15);
    expect(minutesOf("12:15 PM")).toBe(735);
    expect(minutesOf("6:05am")).toBe(365);
    expect(minutesOf("11:59 p.m.")).toBe(1439);
    expect(minutesOf("19:05")).toBe(1145);
    expect(minutesOf("2026-11-09T07:00")).toBe(420);
    expect(minutesOf("8:25 AM+1")).toBe(1945);
    expect(minutesOf("soon")).toBeNull();
  });

  it("names the first airline's code", () => {
    expect(carrierCode("Alaska, Hawaiian")).toBe("AS");
    expect(carrierCode("Delta")).toBe("DL");
    expect(carrierCode("UA")).toBe("UA");
    expect(carrierCode("Air Somewhere")).toBeNull();
  });

  it("turns a printed tax currency into an ISO code only when it's unambiguous", () => {
    expect(currencyOf("$")).toBe("USD");
    expect(currencyOf("USD")).toBe("USD");
    expect(currencyOf("€")).toBe("EUR");
    expect(currencyOf("R$")).toBeNull();
    expect(currencyOf(null)).toBeNull();
  });
});
