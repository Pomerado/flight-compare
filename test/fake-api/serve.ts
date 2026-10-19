/**
 * Runs the fake Pomerado API on port 4010 for working on the app without an account:
 * `npm run fake-api`, then in the app's Settings set the API address to http://127.0.0.1:4010/v1
 * and connect with the key it prints. Every site answers within a few seconds.
 */
import { RESULTS, startFakeApi, TOOLS, VALID_KEY } from "./server.ts";

const quick = (runMs: number, result: () => unknown) => ({ runMs, outcome: "succeeded" as const, result });

const api = await startFakeApi(
  {
    tools: {
      [TOOLS.googleFlights]: quick(6000, RESULTS.googleFlights),
      [TOOLS.googleFlightsRoundTrip]: quick(7000, RESULTS.googleFlights),
      [TOOLS.delta]: quick(2500, RESULTS.delta),
      [TOOLS.deltaRoundTrip]: quick(2500, RESULTS.delta),
      [TOOLS.american]: quick(3500, RESULTS.american),
      [TOOLS.americanRoundTrip]: quick(3500, RESULTS.american),
    },
  },
  4010,
);
console.log(`Fake Pomerado API at ${api.url}`);
console.log(`Key: ${VALID_KEY}`);
