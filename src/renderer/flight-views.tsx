import { formatDuration, formatMoney, formatNumber } from "pomerado-app-kit/shared";
import { SourceLink, type Column, type Pick } from "pomerado-app-kit/renderer";
import { COPY } from "@shared/copy";
import type { FlightOption } from "@shared/flights";
import type { FlightRow, RowAward } from "@shared/rank";

/** How Flight Compare draws a flight: its times, airline and stops, its cash fare and award prices. */

const R = COPY.results;

export const programName = (program: string) => COPY.programs[program as keyof typeof COPY.programs] ?? program;
export const centsText = (cents: number) => (Math.round(cents * 10) / 10).toFixed(1);

export function stopsText(flight: FlightOption) {
  if (flight.stops === null) return null;
  return flight.stops === 0 ? R.nonstop : R.stops(flight.stops);
}

/** "8:25 AM+1" with the +1 raised, as the flight sites print a next-day arrival. */
function Clock({ value }: { value: string | null }) {
  const match = /^(.*?)\s*(\+\d+)$/.exec(value ?? "");
  if (!match) return <>{value ?? ""}</>;
  return (
    <>
      {match[1]}
      <sup className="fc-day">{match[2]}</sup>
    </>
  );
}

export function Times({ flight }: { flight: FlightOption }) {
  return (
    <span className="fc-times">
      <Clock value={flight.departTime} /> – <Clock value={flight.arriveTime} />
    </span>
  );
}

export function CarrierMark({ flight }: { flight: FlightOption }) {
  const code = flight.carrierCode ?? (flight.carrier ?? "?").charAt(0).toUpperCase();
  return (
    <span className="fc-carrier" aria-hidden="true">
      {code}
    </span>
  );
}

/** "Delta · 7h 43m · 1 stop via MSP" */
export function flightMeta(flight: FlightOption, withCarrier = true) {
  const stops = stopsText(flight);
  const via = flight.via.length > 0 ? R.via(flight.via.join(", ")) : null;
  return [
    withCarrier ? flight.carrier : null,
    flight.durationMinutes === null ? null : formatDuration(flight.durationMinutes),
    [stops, via].filter(Boolean).join(" ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const awardText = (award: RowAward) => R.points(formatNumber(award.points), programName(award.program));
export const taxesText = (award: RowAward) =>
  award.taxesMinor === null ? null : R.taxes(formatMoney(award.taxesMinor, award.taxesCurrency ?? "USD"));

function AwardLines({ row }: { row: FlightRow }) {
  if (row.awards.length === 0) return null;
  return (
    <ul className="fc-awards">
      {row.awards.map((award) => {
        const value = row.centsPerPoint.find((item) => item.program === award.program);
        const taxes = taxesText(award);
        return (
          <li key={award.program} className="fc-award">
            <SourceLink href={award.source.url} className="fc-award-points">
              {awardText(award)}
            </SourceLink>
            {taxes ? <span className="fc-award-taxes">{taxes}</span> : null}
            {award.scope === "outbound_only" ? <span className="fc-tag">{R.outboundOnly}</span> : null}
            {award.scope === "round_trip" ? <span className="fc-tag">{R.roundTrip}</span> : null}
            {value ? <span className="fc-cpp">{R.centsPerPoint(centsText(value.cents))}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function CashCell({ row }: { row: FlightRow }) {
  if (!row.cash) return <span className="fc-none">{R.noCash}</span>;
  return (
    <div className="fc-cash">
      <span className="fc-cash-amount">{formatMoney(row.cash.amountMinor, row.cash.currency)}</span>
      <SourceLink href={row.cash.source.url} className="fc-cash-source">
        {row.cash.source.label}
      </SourceLink>
      {row.cash.scope === "round_trip" ? <span className="fc-tag">{R.roundTrip}</span> : null}
    </div>
  );
}

export const TABLE_COLUMNS: Column<FlightRow>[] = [
  {
    key: "flight",
    header: R.columns.flight,
    cell: (row) => (
      <div className="fc-flight">
        <CarrierMark flight={row.flight} />
        <div>
          <p className="fc-flight-times">
            <Times flight={row.flight} />
          </p>
          <p className="fc-flight-meta">
            {[row.flight.carrier, row.flight.origin && row.flight.destination ? `${row.flight.origin}–${row.flight.destination}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
    ),
  },
  {
    key: "duration",
    header: R.columns.duration,
    shrink: true,
    cell: (row) => (row.flight.durationMinutes === null ? "" : formatDuration(row.flight.durationMinutes)),
  },
  {
    key: "stops",
    header: R.columns.stops,
    shrink: true,
    cell: (row) => (
      <div>
        <p>{stopsText(row.flight)}</p>
        {row.flight.via.length > 0 ? <p className="fc-flight-meta">{row.flight.via.join(", ")}</p> : null}
      </div>
    ),
  },
  { key: "cash", header: R.columns.cash, shrink: true, align: "end", cell: (row) => <CashCell row={row} /> },
  { key: "points", header: R.columns.points, cell: (row) => <AwardLines row={row} /> },
];

/** A row as a card, for narrow windows. */
export function FlightCard({ row }: { row: FlightRow }) {
  return (
    <article className="fc-card">
      <div className="fc-card-top">
        <CarrierMark flight={row.flight} />
        <div className="fc-card-text">
          <p className="fc-flight-times">
            <Times flight={row.flight} />
          </p>
          <p className="fc-flight-meta">{flightMeta(row.flight)}</p>
        </div>
        <CashCell row={row} />
      </div>
      {row.awards.length > 0 ? (
        <div className="fc-card-awards">
          <AwardLines row={row} />
        </div>
      ) : null}
    </article>
  );
}

/** The best pick banner's content for a row. */
export function pickFor(row: FlightRow): Pick {
  const award = row.awards[0];
  if (row.cash) {
    return {
      title: <Times flight={row.flight} />,
      meta: flightMeta(row.flight),
      price: formatMoney(row.cash.amountMinor, row.cash.currency),
      priceNote: row.cash.scope === "round_trip" ? R.roundTrip : row.cash.source.label,
      reason: R.bestCashReason,
      source: { label: row.cash.source.label, href: row.cash.source.url },
    };
  }
  return {
    title: <Times flight={row.flight} />,
    meta: flightMeta(row.flight),
    price: award ? awardText(award) : "",
    priceNote: award ? (taxesText(award) ?? undefined) : undefined,
    reason: R.bestPointsReason,
    source: award ? { label: award.source.label, href: award.source.url } : undefined,
  };
}

export function valuePickFor(row: FlightRow, program: string, cents: number): Pick {
  const award = row.awards.find((item) => item.program === program) ?? row.awards[0]!;
  return {
    label: R.bestValueLabel,
    title: <Times flight={row.flight} />,
    meta: flightMeta(row.flight),
    price: awardText(award),
    priceNote: taxesText(award) ?? undefined,
    reason: R.bestValueReason(centsText(cents)),
    source: { label: award.source.label, href: award.source.url },
  };
}
