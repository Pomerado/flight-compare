/**
 * Every word Flight Compare shows a person, beside the kit's own (pomerado-app-kit's copy.ts).
 * Nothing here ships until it is approved word for word, so change wording here and nowhere else.
 *
 * Style: plain words, short sentences, no dashes, colons or semicolons inside sentences. Never
 * mention repairs or raw error codes. Say up front when a site is slow.
 */
export const COPY = {
  appName: "Flight Compare",
  environment: {
    staging: "Staging",
    local: "Local",
  },
  ask: {
    title: "Compare flights",
    lede: "Cash fares from Google Flights and award prices from airline programs, side by side.",
    origin: "From",
    destination: "To",
    departure: "Depart",
    return: "Return",
    cabin: "Cabin",
    passengers: "Passengers",
    optional: "Optional",
    airportHint: "Use a 3-letter airport code like SFO.",
    sameAirport: "Pick a different destination.",
    returnBeforeDeparture: "Pick a return date on or after your departure.",
    cabins: {
      economy: "Economy",
      premium_economy: "Premium economy",
      business: "Business",
      first: "First",
    },
    submit: "Compare flights",
    slowNote: "Google Flights usually takes one to two minutes. Each site's results show up as soon as it finishes.",
  },
  sites: {
    google_flights: "Google Flights",
    american: "American Airlines",
    delta: "Delta",
    united: "United",
  },
  /** The name of each program's points, as in "45,000 American miles". */
  programs: {
    american: "American miles",
    delta: "Delta miles",
    united: "United miles",
  },
  placeholder: {
    title: "Cash and points, side by side",
    body: "Pick a route and a date. Google Flights and each airline's award search run at the same time.",
  },
  results: {
    count: (count: number) => (count === 1 ? "1 flight" : `${count} flights`),
    none: "No flights",
    rule: "Sorted by cash price, then by fewest points. Cents per point shows when the same flight has both prices.",
    roundTripNote: "Cash prices are for the round trip. Award prices are for the outbound flight only.",
    columns: {
      flight: "Flight",
      duration: "Duration",
      stops: "Stops",
      cash: "Cash",
      points: "Points",
    },
    nonstop: "Nonstop",
    stops: (count: number) => (count === 1 ? "1 stop" : `${count} stops`),
    via: (airports: string) => `via ${airports}`,
    points: (points: string, program: string) => `${points} ${program}`,
    taxes: (money: string) => `+ ${money}`,
    centsPerPoint: (cents: string) => `${cents} cents a point`,
    roundTrip: "Round trip",
    outboundOnly: "Outbound only",
    noCash: "No cash fare",
    bestCashReason: "Lowest cash price found.",
    bestPointsReason: "Fewest points found.",
    bestValueLabel: "Best use of points",
    bestValueReason: (cents: string) => `Worth ${cents} cents a point against the cash fare.`,
    emptyTitle: "No flights found",
    emptyBody: "Try other dates or a nearby airport.",
    failedTitle: "No results this time",
    failedBody: "None of the sites could finish. Try again in a few minutes.",
    more: "Show more flights",
  },
} as const;
