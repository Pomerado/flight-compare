import { expect, test } from "@playwright/test";
import { RESULTS, startFakeApi, TOOLS, type FakeApi, type Scenario } from "../fake-api/server.ts";
import { connect, daysAhead, launchApp, search, site, type Launched } from "./helpers.ts";

let api: FakeApi | null = null;
let launched: Launched | null = null;

async function start(scenario: Scenario, options: { siteTimeoutSeconds?: number } = {}) {
  api = await startFakeApi(scenario);
  launched = await launchApp(api, options);
  await connect(launched.page);
  return { api, ...launched };
}

test.afterEach(async () => {
  await launched?.close();
  await api?.close();
  launched = null;
  api = null;
});

test("results show as each site finishes, and a site past its wait is stopped", async () => {
  const { page, api } = await start(
    {
      tools: {
        [TOOLS.delta]: { runMs: 1200, outcome: "succeeded", result: RESULTS.delta },
        [TOOLS.american]: { runMs: 2000, outcome: "succeeded", result: RESULTS.american },
        [TOOLS.googleFlights]: { runMs: 60_000, outcome: "never" },
      },
    },
    { siteTimeoutSeconds: 6 },
  );
  await search(page);

  // Google Flights is still searching while Delta's award flights are already on screen.
  await expect(site(page, "delta")).toContainText("3 flights");
  await expect(site(page, "google_flights")).toContainText("Searching Google Flights");
  await expect(page.getByTestId("best-pick")).toContainText("Fewest points found.");
  await expect(page.getByRole("table")).toContainText("14,500 Delta miles");
  await expect(site(page, "american")).toContainText("2 flights");

  // Past its wait, Google Flights says so plainly, offers a retry, and its job is cancelled.
  await expect(site(page, "google_flights")).toContainText("Google Flights took too long.", { timeout: 15_000 });
  await expect(site(page, "google_flights").getByRole("button", { name: "Try again" })).toBeVisible();
  const googleJob = api.startedJobs().find((job) => job.toolId === TOOLS.googleFlights);
  await expect.poll(() => api.cancelledJobIds()).toContain(googleJob?.id);
  // The finished sites' jobs are never cancelled.
  const finished = api.startedJobs().filter((job) => job.toolId !== TOOLS.googleFlights).map((job) => job.id);
  expect(api.cancelledJobIds().filter((id) => finished.includes(id))).toEqual([]);
});

test("cash and points line up for the same flight, with cents per point", async () => {
  const { page } = await start({
    tools: {
      [TOOLS.delta]: { runMs: 800, outcome: "succeeded", result: RESULTS.delta },
      [TOOLS.american]: { runMs: 900, outcome: "succeeded", result: RESULTS.american },
      [TOOLS.googleFlights]: { runMs: 1500, outcome: "succeeded", result: RESULTS.googleFlights },
    },
  });
  await search(page);
  await expect(site(page, "google_flights")).toContainText("6 flights");
  const pick = page.getByTestId("best-pick");
  await expect(pick).toContainText("$196");
  await expect(pick).toContainText("Lowest cash price found.");
  // The cheapest fare is a Delta flight that also has an award price, so its row shows both.
  const firstRow = page.getByRole("row").nth(1);
  await expect(firstRow).toContainText("$196");
  await expect(firstRow).toContainText("14,500 Delta miles");
  await expect(firstRow).toContainText("1.3 cents a point");
  await expect(page.getByTestId("best-value")).toContainText("Worth 1.6 cents a point against the cash fare.");
});

test("a run refused for the day's limit shows when runs come back and the upgrade link", async () => {
  const refuse = { runMs: 0, outcome: "succeeded" as const, refuse: { status: 429, code: "quota_exceeded" } };
  const { page, opened } = await start({
    tools: { [TOOLS.googleFlights]: refuse, [TOOLS.american]: refuse, [TOOLS.delta]: refuse },
  });
  await search(page);
  const notice = page.getByTestId("quota-hit");
  await expect(notice).toContainText("You've used today's runs");
  await expect(notice).toContainText(/Your runs come back (at|on) .+\. Premium gives you 1,000 runs a day\./);
  await expect(page.getByTestId("runs-left")).toHaveText("No runs left today.");
  await notice.getByRole("button", { name: "Upgrade to Premium" }).click();
  await expect.poll(opened).toContain("https://app.pomerado.ai/upgrade");
  // Nothing in the screen names an error code.
  await expect(page.locator("body")).not.toContainText("quota_exceeded");
});

test("a site that needs an answer opens Pomerado's answer page and carries on once answered", async () => {
  const { page, api, opened } = await start({
    tools: {
      [TOOLS.googleFlights]: { runMs: 1500, outcome: "succeeded", result: RESULTS.googleFlights, askAfterMs: 500 },
      [TOOLS.delta]: { runMs: 800, outcome: "succeeded", result: RESULTS.delta },
      [TOOLS.american]: { runMs: 800, outcome: "succeeded", result: RESULTS.american },
    },
  });
  await search(page);
  const google = site(page, "google_flights");
  await expect(google).toContainText("Google Flights needs an answer from you");
  await google.getByRole("button", { name: "Answer in browser" }).click();
  await expect.poll(async () => (await opened()).some((url) => url.startsWith("https://app.pomerado.ai/input/jobs/"))).toBe(true);

  api.answerAll();
  await expect(google).toContainText("6 flights");
  await expect(page.getByTestId("best-pick")).toContainText("$196");
});

test("leaving cancels every search still running", async () => {
  const { page, api, app } = await start({
    tools: {
      [TOOLS.googleFlightsRoundTrip]: { runMs: 60_000, outcome: "never" },
      [TOOLS.deltaRoundTrip]: { runMs: 60_000, outcome: "never" },
      [TOOLS.americanRoundTrip]: { runMs: 400, outcome: "succeeded", result: RESULTS.american },
    },
  });
  await search(page, { returnDate: daysAhead(37) });
  await expect(site(page, "american")).toContainText("2 flights");
  // Round-trip award prices cover the outbound flight only, and say so.
  await expect(page.getByText("Award prices are for the outbound flight only.")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Outbound only");
  await expect.poll(() => api.startedJobs().length).toBe(3);
  // A return date picks each site's round-trip tool.
  expect(api.startedJobs().map((job) => job.toolId).sort()).toEqual(
    [TOOLS.googleFlightsRoundTrip, TOOLS.deltaRoundTrip, TOOLS.americanRoundTrip].sort(),
  );
  const live = api
    .startedJobs()
    .filter((job) => job.toolId !== TOOLS.americanRoundTrip)
    .map((job) => job.id);

  // Closing the window is leaving.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => api.cancelledJobIds().sort()).toEqual(live.sort());
});

test("stopping a search cancels its running jobs", async () => {
  const { page, api } = await start({
    tools: {
      [TOOLS.googleFlights]: { runMs: 60_000, outcome: "never" },
      [TOOLS.delta]: { runMs: 60_000, outcome: "never" },
      [TOOLS.american]: { runMs: 60_000, outcome: "never" },
    },
  });
  await search(page);
  await expect.poll(() => api.startedJobs().length).toBe(3);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => api.cancelledJobIds().length).toBe(3);
  await expect(site(page, "delta")).toContainText("Stopped");
});
