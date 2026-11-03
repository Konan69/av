import { expect } from "@playwright/test";

type Page = import("playwright").Page;
type ElectronApplication = import("playwright").ElectronApplication;

export const waitForProjectReady = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () => globalThis.nwWrldBridge?.project?.isDirAvailable?.() === true,
    undefined,
    { timeout: 15_000 }
  );
};

export const getDashboardAndProjectorWindows = async (app: ElectronApplication) => {
  await expect
    .poll(() => app.windows().length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);
  const windows = app.windows();
  const dashboard = windows.find((w) => w.url().includes("dashboard.html")) || windows[0];
  const projector = windows.find((w) => w.url().includes("projector.html")) || windows[1];
  if (!dashboard || !projector) {
    throw new Error("Expected dashboard and projector windows.");
  }
  return { dashboard, projector };
};

