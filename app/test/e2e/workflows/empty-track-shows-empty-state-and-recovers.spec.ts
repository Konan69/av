import { test, expect } from "@playwright/test";

import { createTestWorkspace } from "../fixtures/testWorkspace";
import { launchNwWrld } from "../fixtures/launchElectron";
import {
  getDashboardAndProjectorWindows,
  waitForProjectReady,
} from "../fixtures/windowHelpers";

const getSandboxInstanceCount = async (
  app: import("playwright").ElectronApplication
): Promise<number> => {
  return await app.evaluate(async ({ BrowserWindow }) => {
    try {
      const wins = BrowserWindow.getAllWindows();
      const projectorWin = wins.find((w) => {
        try {
          const url = w.webContents?.getURL?.() || "";
          return url.includes("projector.html") || w.getTitle?.() === "Projector 1";
        } catch {
          return false;
        }
      });
      if (!projectorWin) return 0;
      const views =
        typeof projectorWin.getBrowserViews === "function" ? projectorWin.getBrowserViews() : [];
      const sandboxView = views.find((v) => {
        try {
          const url = v?.webContents?.getURL?.() || "";
          return url.includes("moduleSandbox.html") || url.includes("nw-sandbox://");
        } catch {
          return false;
        }
      });
      const wc = sandboxView?.webContents || null;
      if (!wc || typeof wc.executeJavaScript !== "function") return 0;
      const count = await wc.executeJavaScript(
        `(() => document.querySelectorAll('[data-instance-id]').length)()`,
        true
      );
      return typeof count === "number" ? count : 0;
    } catch {
      return 0;
    }
  });
};

test("empty enabled modules shows empty state and recovers when module is added", async () => {
  const { dir, cleanup } = await createTestWorkspace();
  const app = await launchNwWrld({ projectDir: dir });
  const suffix = String(Date.now());
  const setName = `E2E Set ${suffix}`;
  const trackName = `E2E Track ${suffix}`;

  try {
    await app.firstWindow();
    const { dashboard, projector } = await getDashboardAndProjectorWindows(app);
    await waitForProjectReady(dashboard);
    await waitForProjectReady(projector);

    await dashboard.getByText("SETS", { exact: true }).click();
    await dashboard.getByText("Create Set", { exact: true }).click();
    await dashboard.locator("#set-name").fill(setName);
    await dashboard.getByText("Create Set", { exact: true }).click();
    await expect(dashboard.locator("#set-name")).toBeHidden();

    await dashboard.getByText("TRACKS", { exact: true }).click();
    await dashboard.getByText("Create Track", { exact: true }).click();
    await dashboard.locator('input[placeholder="My Performance Track"]').fill(trackName);
    await dashboard.getByText("Create Track", { exact: true }).click();
    await expect(dashboard.locator('input[placeholder="My Performance Track"]')).toBeHidden();

    await dashboard.evaluate((name) => {
      globalThis.nwWrldBridge?.messaging?.sendToProjector?.("track-activate", { trackName: name });
    }, trackName);

    await expect
      .poll(async () => {
        const text = await projector.evaluate(() => {
          const el = document.getElementById("projector-render-status-text");
          return el?.textContent || "";
        });
        return text.includes("No enabled modules");
      })
      .toBe(true);

    await expect
      .poll(async () => await getSandboxInstanceCount(app))
      .toBe(0);

    await dashboard.getByText("MODULE", { exact: true }).click();
    const addButtons = dashboard.getByTestId("add-module-to-track");
    await expect(addButtons.first()).toBeVisible();
    await addButtons.first().click();
    await expect(addButtons.first()).toBeHidden();

    await dashboard.evaluate((name) => {
      globalThis.nwWrldBridge?.messaging?.sendToProjector?.("track-activate", { trackName: name });
    }, trackName);

    await expect
      .poll(async () => await getSandboxInstanceCount(app))
      .toBeGreaterThan(0);

    await expect
      .poll(async () => {
        return await projector.evaluate(() => {
          const el = document.getElementById("projector-render-status");
          if (!el) return false;
          return (el as HTMLElement).style.display === "none";
        });
      })
      .toBe(true);
  } finally {
    try {
      await app.close();
    } catch {}
    await cleanup();
  }
});

