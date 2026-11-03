import { test, expect } from "@playwright/test";

import { createTestWorkspace } from "../fixtures/testWorkspace";
import { launchNwWrld } from "../fixtures/launchElectron";
import {
  getDashboardAndProjectorWindows,
  waitForProjectReady,
} from "../fixtures/windowHelpers";

test("track activation emits loading status then returns to ready", async () => {
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

    await projector.evaluate(() => {
      const g = globalThis as unknown as { __nwWrldRenderStatusHistory?: string[] };
      g.__nwWrldRenderStatusHistory = [];
      const record = () => {
        const host = document.getElementById("projector-render-status");
        const text = document.getElementById("projector-render-status-text");
        const visible = host && (host as HTMLElement).style.display !== "none" ? "visible" : "hidden";
        const label = text?.textContent || "";
        g.__nwWrldRenderStatusHistory?.push(`${visible}:${label}`);
      };
      const observer = new MutationObserver(() => record());
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
      record();
    });

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

    await dashboard.evaluate((name) => {
      globalThis.nwWrldBridge?.messaging?.sendToProjector?.("track-activate", { trackName: name });
    }, trackName);

    await expect
      .poll(async () => {
        return await projector.evaluate(() => {
          const g = globalThis as unknown as { __nwWrldRenderStatusHistory?: string[] };
          const history = Array.isArray(g.__nwWrldRenderStatusHistory) ? g.__nwWrldRenderStatusHistory : [];
          return history.some((x) => x.includes("visible:Loading track..."));
        });
      })
      .toBe(true);

    await expect
      .poll(async () => {
        return await projector.evaluate(() => {
          const host = document.getElementById("projector-render-status");
          if (!host) return false;
          return (host as HTMLElement).style.display === "none";
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

