import { expect, test } from "@playwright/test";
import { isHex, parseEther, type Hex } from "viem";
import { DISPUTE_ADDRESS } from "../src/contracts.js";
import { installTestWallet } from "./wallet.js";

const PRIVATE_KEY = process.env.E2E_PRIVATE_KEY;
const COUNTERPARTY = process.env.E2E_COUNTERPARTY ?? "0xBc94d3C1F9599Fbe3D6f4DCa5aAD679d2C504799";
const RPC_URL = process.env.E2E_BASE_RPC_URL ?? "https://sepolia.base.org";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const SHOTS = process.env.E2E_SHOTS ?? "test-results";
const ETHEREUM_SEPOLIA = 11_155_111;
const RELAYER_BUDGET_MS = 12 * 60_000;

test.skip(!PRIVATE_KEY || !isHex(PRIVATE_KEY), "set E2E_PRIVATE_KEY to a funded Base Sepolia key to run the live judge flow");

test("a judge with a fresh wallet opens a dispute and watches every step", async ({ page }) => {
  test.setTimeout(RELAYER_BUDGET_MS + 3 * 60_000);
  const address = await installTestWallet(page, {
    privateKey: PRIVATE_KEY as Hex,
    rpcUrl: RPC_URL,
    startChainId: ETHEREUM_SEPOLIA,
    origin: new URL(BASE_URL).origin,
    allowedTo: DISPUTE_ADDRESS,
    maxValueWei: parseEther("0.002"),
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Switch to Base Sepolia" }).click();
  await expect(page.getByText(`${address.slice(0, 6)}…${address.slice(-4)}`)).toBeVisible();

  await page.getByRole("button", { name: /Logo delivered as specified/ }).click();
  await page.getByLabel("Counterparty address").fill(COUNTERPARTY);
  await expect(page.getByText(/You pay/)).toContainText("0.0011 ETH");
  await page.screenshot({ path: `${SHOTS}/01-form.png`, fullPage: true });
  await page.getByRole("button", { name: "Open dispute" }).click();

  await page.waitForURL(/\/app\/r\/\d+$/, { timeout: 120_000 });
  const id = page.url().split("/").at(-1);
  test.info().annotations.push({ type: "dispute", description: `#${id} from ${address}` });
  await expect(page.getByText("Question recorded on Base (done)")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/02-opened.png`, fullPage: true });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("deliver a logo", { timeout: 120_000 });

  await expect(page.getByText("(done)")).toHaveCount(5, { timeout: RELAYER_BUDGET_MS });
  await expect(page.getByRole("status")).toContainText("YES. 0.001 ETH went back to the claimant", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Check it yourself" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-settled-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: `${SHOTS}/04-settled-mobile.png`, fullPage: true });
});
