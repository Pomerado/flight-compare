import { expect, test } from "@playwright/test";
import { startFakeApi, type FakeApi } from "../fake-api/server.ts";
import { connect, launchApp, type Launched } from "./helpers.ts";

let api: FakeApi;
let launched: Launched;

test.beforeEach(async () => {
  api = await startFakeApi({ quota: { remaining: 87, limit: 100 }, tools: {} });
  launched = await launchApp(api);
});

test.afterEach(async () => {
  await launched.close();
  await api.close();
});

test("a valid key connects and shows today's runs", async () => {
  const { page, opened } = launched;
  await expect(page.getByRole("heading", { name: "Connect Pomerado" })).toBeVisible();

  // Step 2 opens the Dashboard's key form, prefilled with the app's name and run permissions.
  await page.getByRole("button", { name: "Make a key" }).click();
  await expect.poll(opened).toHaveLength(1);
  const link = new URL((await opened())[0]!);
  expect(link.origin + link.pathname).toBe("https://app.pomerado.ai/settings/api-keys");
  expect(link.searchParams.get("name")).toBe("Flight Compare");
  expect(link.searchParams.get("permissions")).toContain("runs:create");
  expect(link.searchParams.get("permissions")).toContain("usage:read");

  await page.getByLabel("Your Pomerado key").fill("pom_test_0123456789abcdefghijklmnop");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connected-runs")).toHaveText(/87 of 100 runs left today\./);
  await expect(page.getByTestId("runs-left")).toHaveText("87 of 100 runs left today.");
  await page.getByRole("button", { name: "Start searching" }).click();
  await expect(page.getByRole("heading", { name: "Compare flights" })).toBeVisible();
  expect(api.requests.filter((request) => request.path === "/v1/quota" && request.authorized).length).toBeGreaterThan(0);
});

test("a key Pomerado refuses keeps the person on the connect screen with a plain message", async () => {
  const { page } = launched;
  await page.getByLabel("Your Pomerado key").fill("pom_revoked_key_000000000000");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Pomerado didn't accept that key. Make a new key and paste it again.");
  await expect(page.getByRole("heading", { name: "Connect Pomerado" })).toBeVisible();
  await expect(page.getByTestId("runs-left")).toHaveCount(0);

  // Something that isn't a key at all never leaves the app.
  const before = api.requests.length;
  await page.getByLabel("Your Pomerado key").fill("not a key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("That doesn't look like a Pomerado key. Keys start with pom_.");
  expect(api.requests.length).toBe(before);
});

test("disconnecting from settings goes back to the connect screen", async () => {
  const { page } = launched;
  await connect(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pomerado" })).toBeVisible();
});
