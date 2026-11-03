import { test, expect } from "@playwright/test";

import { createTestWorkspace } from "../fixtures/testWorkspace";
import { launchNwWrld } from "../fixtures/launchElectron";
import {
  getDashboardAndProjectorWindows,
  waitForProjectReady,
} from "../fixtures/windowHelpers";

const getProjectorWindowId = async (app: import("playwright").ElectronApplication) => {
  return await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    const projector = wins.find((w) => {
      try {
        const url = w.webContents?.getURL?.() || "";
        return url.includes("projector.html") || w.getTitle?.() === "Projector 1";
      } catch {
        return false;
      }
    });
    if (!projector) return null;
    try {
      return projector.id;
    } catch {
      return null;
    }
  });
};

const closeProjectorWindow = async (app: import("playwright").ElectronApplication) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    const projector = wins.find((w) => {
      try {
        const url = w.webContents?.getURL?.() || "";
        return url.includes("projector.html") || w.getTitle?.() === "Projector 1";
      } catch {
        return false;
      }
    });
    if (!projector) return;
    try {
      projector.close();
    } catch {}
  });
};

const getSandboxInstanceIds = async (
  app: import("playwright").ElectronApplication
): Promise<string[]> => {
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
      if (!projectorWin) return [];
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
      if (!wc || typeof wc.executeJavaScript !== "function") return [];
      const instanceIdsRaw = await wc.executeJavaScript(
        `(() => Array.from(document.querySelectorAll('[data-instance-id]'))
          .map((n) => n && n.getAttribute && n.getAttribute('data-instance-id'))
          .filter((x) => typeof x === 'string' && x.trim().length > 0))()`,
        true
      );
      return Array.isArray(instanceIdsRaw) ? instanceIdsRaw : [];
    } catch {
      return [];
    }
  });
};

test("closing projector window recreates projector and preserves rendering path", async () => {
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

    await dashboard.getByText("MODULE", { exact: true }).click();
    const addButtons = dashboard.getByTestId("add-module-to-track");
    await expect(addButtons.first()).toBeVisible();
    await addButtons.first().click();
    await expect(addButtons.first()).toBeHidden();

    const beforeId = await getProjectorWindowId(app);
    expect(beforeId).not.toBeNull();
    await closeProjectorWindow(app);

    await expect
      .poll(async () => {
        const nextId = await getProjectorWindowId(app);
        return typeof nextId === "number" && nextId !== beforeId;
      })
      .toBe(true);

    await dashboard.evaluate((name) => {
      globalThis.nwWrldBridge?.messaging?.sendToProjector?.("track-activate", { trackName: name });
    }, trackName);

    await expect
      .poll(async () => {
        const ids = await getSandboxInstanceIds(app);
        return ids.length > 0;
      })
      .toBe(true);
  } finally {
    try {
      await app.close();
    } catch {}
    await cleanup();
  }
});

