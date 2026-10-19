import { COPY } from "./copy.js";

/**
 * The sites Flight Compare searches: each one a public Pomerado tool, by alias. The ids are the
 * same in production and staging, and every tool here is read-only. A return date picks each
 * site's round-trip tool.
 */

export type SiteKind = "cash" | "award";

/** What a site's prices cover when the trip is round: the whole trip, or the outbound flight only. */
export type RoundTripScope = "round_trip" | "outbound_only";

export type SiteTool = {
  alias: string;
  label: string;
  kind: SiteKind;
  /** The program whose points an award site prices in, keyed into COPY.programs. */
  program?: keyof typeof COPY.programs;
  oneWay: string;
  roundTrip: string | null;
  roundTripScope: RoundTripScope;
  /** Off until the tool works end to end. */
  enabled: boolean;
  /** The tool signs in to the site, so a run may ask for a login or a code. */
  needsLogin: boolean;
  /** How long the site may run before Flight Compare stops waiting, in seconds. */
  timeoutSeconds: number;
};

export const SITE_TOOLS: SiteTool[] = [
  {
    alias: "google_flights",
    label: COPY.sites.google_flights,
    kind: "cash",
    oneWay: "tool_e3257cb40c2388c5523aca87d093a091",
    roundTrip: "tool_6a3b3272e28d38bf72801b7437fd0eee",
    roundTripScope: "round_trip",
    enabled: true,
    needsLogin: false,
    // Production runs take one to two minutes, and round trips often longer.
    timeoutSeconds: 240,
  },
  {
    alias: "american",
    label: COPY.sites.american,
    kind: "award",
    program: "american",
    oneWay: "tool_65883b0821eef8fd9b9ad0c1c76384d1",
    roundTrip: "tool_77468f645784ce7a02e37f99b4fd8566",
    roundTripScope: "outbound_only",
    enabled: true,
    needsLogin: false,
    timeoutSeconds: 180,
  },
  {
    alias: "delta",
    label: COPY.sites.delta,
    kind: "award",
    program: "delta",
    oneWay: "tool_8c892f491604a217ca39a4463644ec07",
    roundTrip: "tool_2721b4ebfbaea5c91f5fa2fea4beebfc",
    roundTripScope: "outbound_only",
    enabled: true,
    needsLogin: false,
    timeoutSeconds: 180,
  },
  {
    // Needs a United login (email, MileagePlus number, password, then a text message code), which
    // the run asks for on Pomerado's answer page. Off while the tool is rebuilt.
    alias: "united",
    label: COPY.sites.united,
    kind: "award",
    program: "united",
    oneWay: "tool_ed898545b7c88650847580ad55f3d001",
    roundTrip: null,
    roundTripScope: "outbound_only",
    enabled: false,
    needsLogin: true,
    timeoutSeconds: 300,
  },
];

export const enabledSites = (tools: SiteTool[] = SITE_TOOLS) => tools.filter((tool) => tool.enabled);
