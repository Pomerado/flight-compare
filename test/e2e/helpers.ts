import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { VALID_KEY, type FakeApi } from "../fake-api/server.ts";

const APP_ROOT = resolve(import.meta.dirname, "../..");

export type Launched = {
  app: ElectronApplication;
  page: Page;
  /** Addresses the app asked the system browser to open. */
  opened(): Promise<string[]>;
  close(): Promise<void>;
};

/**
 * Starts the built app with a fresh profile pointed at the fake API. The system browser is
 * replaced with a recorder, so nothing opens during tests.
 */
export async function launchApp(api: FakeApi, options: { siteTimeoutSeconds?: number; width?: number; height?: number } = {}): Promise<Launched> {
  const profile = mkdtempSync(join(tmpdir(), "flight-compare-test-"));
  writeFileSync(
    join(profile, "pomerado-settings.json"),
    JSON.stringify({
      apiBase: api.url,
      dashboardBase: "https://app.pomerado.ai",
      ...(options.siteTimeoutSeconds ? { siteTimeoutSeconds: options.siteTimeoutSeconds } : {}),
    }),
  );
  const app = await electron.launch({
    args: [APP_ROOT, "--no-sandbox"],
    env: { ...process.env, FLIGHT_COMPARE_USER_DATA: profile, ELECTRON_RENDERER_URL: "" },
  });
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const page = await app.firstWindow();
  await resize(app, options.width ?? 1200, options.height ?? 860);
  return {
    app,
    page,
    opened: () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened),
    close: async () => {
      await app.close().catch(() => undefined);
    },
  };
}

export async function resize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

/** Pastes a key on the connect screen and goes on to search. */
export async function connect(page: Page, key = VALID_KEY) {
  await page.getByLabel("Your Pomerado key").fill(key);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You're connected" })).toBeVisible();
  await page.getByRole("button", { name: "Start searching" }).click();
  await expect(page.getByRole("heading", { name: "Compare flights" })).toBeVisible();
}

/** A date this many days ahead, as YYYY-MM-DD. */
export function daysAhead(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function search(page: Page, options: { returnDate?: string } = {}) {
  await page.getByLabel("From").fill("SFO");
  await page.getByLabel("To", { exact: true }).fill("JFK");
  await page.getByLabel("Depart").fill(daysAhead(30));
  if (options.returnDate) await page.getByLabel(/^Return/).fill(options.returnDate);
  await page.getByRole("button", { name: "Compare flights" }).click();
}

export const site = (page: Page, key: string) => page.locator(`[data-site="${key}"]`);
