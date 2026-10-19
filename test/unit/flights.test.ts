import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carrierCode, minutesOf, normalizeAward, normalizeGoogleFlights } from "../../src/shared/flights.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const cash = { key: "google_flights-0", label: "Google Flights", scope: "one_way" } as const;
const award = { key: "delta-0", label: "Delta", scope: "one_way", program: "delta" } as const;

describe("normalizeGoogleFlights", () => {
  it("reads each priced flight with its times, stops and Google's search link", () => {
    const flights = normalizeGoogleFlights(fixture("google-flights.json"), cash);
    expect(flights).toHaveLength(6);
    const delta = flights.find((flight) => flight.departTime === "6:05 AM")!;
    expect(delta).toMatchObject({
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
    });
    expect(delta.source.url).toMatch(/^https:\/\/www\.google\.com\/travel\/flights/);
  });

  it("keeps a next-day arrival's day", () => {
    const late = normalizeGoogleFlights(fixture("google-flights.json"), cash).find((flight) => flight.departTime === "11:59 PM")!;
    expect(late.arriveTime).toBe("8:25 AM+1");
    expect(late.arriveMinutes).toBe(8 * 60 + 25 + 1440);
  });

  it("leaves out unpriced flights and anything that isn't a result", () => {
    const result = { flights: [{ airline: "Alaska", price_minor: null }, { airline: "Delta", price_minor: 0 }, "junk"] };
    expect(normalizeGoogleFlights(result, cash)).toEqual([]);
    expect(normalizeGoogleFlights(null, cash)).toEqual([]);
    expect(normalizeGoogleFlights({ flights: "none" }, cash)).toEqual([]);
  });

  it("never links to anything but an https page", () => {
    const result = { search_url: "javascript:alert(1)", flights: [{ airline: "Delta", price_minor: 100, booking_url: "http://example.com" }] };
    expect(normalizeGoogleFlights(result, cash)[0]?.source.url).toBeNull();
  });
});

describe("normalizeAward", () => {
  it("reads points, taxes and flight numbers", () => {
    const flights = normalizeAward(fixture("delta-award.json"), award);
    expect(flights).toHaveLength(3);
    expect(flights[0]).toMatchObject({
      carrierCode: "DL",
      flightNumbers: ["DL1102", "DL2210"],
      price: { kind: "award", program: "delta", points: 14500, taxesMinor: 560, taxesCurrency: "USD" },
    });
  });

  it("marks a next-day arrival from the arrival date", () => {
    const late = normalizeAward(fixture("delta-award.json"), award)[1]!;
    expect(late.arriveTime).toBe("8:25 AM+1");
    expect(late.arriveMinutes).toBe(8 * 60 + 25 + 1440);
  });

  it("takes the fare in the asked cabin, else the fewest points", () => {
    const row = {
      airline: "Delta",
      departure_time: "07:00",
      arrival_time: "15:30",
      fares: [
        { cabin: "business", miles: 80000, taxes_minor: 560 },
        { cabin: "economy", miles: 30000, taxes_minor: 560 },
        { cabin: "premium_economy", miles: 45000, taxes_minor: 560 },
      ],
    };
    const [business] = normalizeAward({ flights: [row] }, { ...award, cabin: "business" });
    expect(business?.price).toMatchObject({ points: 80000 });
    const [first] = normalizeAward({ flights: [row] }, { ...award, cabin: "first" });
    expect(first?.price).toMatchObject({ points: 30000 });
    expect(first?.departTime).toBe("7:00 AM");
    expect(first?.arriveTime).toBe("3:30 PM");
  });

  it("reads the other names a points field may have", () => {
    const [flight] = normalizeAward({ results: [{ carrier: "AA", points: 12000, fees_minor: 1120, taxes_currency: "USD" }] }, award);
    expect(flight?.price).toMatchObject({ points: 12000, taxesMinor: 1120 });
    expect(flight?.carrierCode).toBe("AA");
  });

  it("leaves out rows without points", () => {
    expect(normalizeAward({ flights: [{ airline: "Delta", miles: null }, { airline: "Delta" }] }, award)).toEqual([]);
  });
});

describe("times and carriers", () => {
  it("reads the clock formats sites use", () => {
    expect(minutesOf("7:00 AM")).toBe(420);
    expect(minutesOf("12:15 AM")).toBe(15);
    expect(minutesOf("12:15 PM")).toBe(735);
    expect(minutesOf("19:05")).toBe(1145);
    expect(minutesOf("2026-11-09T07:00:00-08:00")).toBe(420);
    expect(minutesOf("8:25 AM+1")).toBe(1945);
    expect(minutesOf("soon")).toBeNull();
  });

  it("names the first airline's code", () => {
    expect(carrierCode("Alaska, Hawaiian")).toBe("AS");
    expect(carrierCode("Delta")).toBe("DL");
    expect(carrierCode("UA")).toBe("UA");
    expect(carrierCode("Air Somewhere")).toBeNull();
  });
});
