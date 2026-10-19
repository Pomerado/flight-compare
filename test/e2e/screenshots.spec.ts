import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { RESULTS, startFakeApi, TOOLS, type FakeApi } from "../fake-api/server.ts";
import { connect, launchApp, resize, search, site, type Launched } from "./helpers.ts";

/**
 * Screenshots for review at 390 px (phone, the 9:16 videos) and 1440 px (desktop), against the
 * fake API's synthetic results. Run with `npm run screenshots`; skipped otherwise.
 */
test.skip(!process.env.SCREENSHOTS, "screenshots run only with SCREENSHOTS=1");

const OUT = resolve(import.meta.dirname, "../../docs/screenshots");
const SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;

let api: FakeApi | null = null;
let launched: Launched | null = null;

test.afterEach(async () => {
  await launched?.close();
  await api?.close();
});

async function shoot(page: Page, name: string, fullPage = true) {
  mkdirSync(OUT, { recursive: true });
  // Let entrance animations settle, and capture from the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  // Nothing may push the window sideways, at any width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
}

for (const size of SIZES) {
  test(`connect and results at ${size.name}`, async () => {
    api = await startFakeApi({
      tools: {
        [TOOLS.googleFlights]: { runMs: 2500, outcome: "succeeded", result: RESULTS.googleFlights },
        [TOOLS.delta]: { runMs: 900, outcome: "succeeded", result: RESULTS.delta },
        [TOOLS.american]: { runMs: 60_000, outcome: "never" },
      },
    });
    launched = await launchApp(api, { width: size.width, height: size.height });
    const { page, app } = launched;
    await resize(app, size.width, size.height);
    await expect(page.getByRole("heading", { name: "Connect Pomerado" })).toBeVisible();
    await shoot(page, `connect-${size.name}`);
    await connect(page);
    await shoot(page, `search-${size.name}`, false);
    await search(page);
    await expect(site(page, "delta")).toContainText("3 flights");
    await shoot(page, `searching-${size.name}`);
    await expect(site(page, "google_flights")).toContainText("6 flights");
    await shoot(page, `results-${size.name}`);
  });

  test(`quota hit at ${size.name}`, async () => {
    const refuse = { runMs: 0, outcome: "succeeded" as const, refuse: { status: 429, code: "quota_exceeded" } };
    api = await startFakeApi({ tools: { [TOOLS.googleFlights]: refuse, [TOOLS.american]: refuse, [TOOLS.delta]: refuse } });
    launched = await launchApp(api, { width: size.width, height: size.height });
    const { page } = launched;
    await connect(page);
    await search(page);
    await expect(page.getByTestId("quota-hit")).toBeVisible();
    await shoot(page, `quota-${size.name}`);
  });

  test(`needs an answer at ${size.name}`, async () => {
    api = await startFakeApi({
      tools: {
        [TOOLS.googleFlights]: { runMs: 60_000, outcome: "never" },
        [TOOLS.delta]: { runMs: 60_000, outcome: "succeeded", askAfterMs: 300 },
        [TOOLS.american]: { runMs: 800, outcome: "succeeded", result: RESULTS.american },
      },
    });
    launched = await launchApp(api, { width: size.width, height: size.height });
    const { page } = launched;
    await connect(page);
    await search(page);
    await expect(site(page, "delta")).toContainText("Delta needs an answer from you");
    await expect(site(page, "american")).toContainText("2 flights");
    await shoot(page, `needs-input-${size.name}`);
  });
}
