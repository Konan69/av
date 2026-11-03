import logger from "../../helpers/logger";
import { TrackSandboxHost } from "../sandbox/TrackSandboxHost";
import { getMessaging } from "../bridge";

type PreviewControllerContext = {
  previewToken: number;
  deferredClearPreviewToken: number | null;
  isPreviewLoading: boolean;
  previewModuleName: unknown;
  restoreTrackNameAfterPreview: unknown;

  activeTrack: { name?: unknown } | null;
  activeModules: Record<string, unknown>;
  trackSandboxHost: { destroy?: () => unknown; token?: unknown; ensureSandbox?: () => Promise<unknown> | unknown; initTrack?: (args: unknown) => Promise<unknown>; invokeOnInstance?: (id: unknown, methodName: unknown, options: unknown) => Promise<unknown> } | null;
  trackModuleSources: unknown;

  loadWorkspaceModuleSource: (moduleName: unknown) => Promise<{ text?: unknown } | null>;
  deactivateActiveTrack: () => unknown;
  handleTrackSelection: (trackName: unknown) => unknown;
  getAssetsBaseUrlForSandboxToken: (token: unknown) => string | null;

  clearPreviewForModule: (
    moduleName: unknown,
    options?: { restoreTrack?: boolean }
  ) => unknown;
};

export async function previewModule(
  this: PreviewControllerContext,
  moduleName: unknown,
  moduleData: unknown,
  requestId: unknown = null
) {
  const sendPreviewCancelled = () => {
    if (!requestId) return;
    const messaging = getMessaging();
    messaging?.sendToDashboard?.("preview-module-error", {
      moduleName,
      requestId,
      error: "PREVIEW_CANCELLED",
    });
  };

  const token = ++this.previewToken;
  if (this.deferredClearPreviewToken === token - 1) {
    this.deferredClearPreviewToken = null;
  }
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(`🎨 [PREVIEW] Starting preview for module: ${moduleName}`);
    logger.log(`🎨 [PREVIEW] Module data received:`, moduleData);
    logger.log(`🎨 [PREVIEW] Clearing any existing preview...`);
  }
  const prevName = this.previewModuleName;
  const inheritedRestoreTrackName = this.restoreTrackNameAfterPreview;
  if (prevName) {
    this.clearPreviewForModule(prevName, { restoreTrack: false });
  }

  const modulesContainer = document.querySelector(".modules");
  if (debugEnabled) {
    logger.log(`🎨 [PREVIEW] Modules container found:`, !!modulesContainer);
  }
  if (!modulesContainer) {
    logger.error("❌ [PREVIEW] No .modules container found in DOM");
    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-error", {
        moduleName,
        requestId,
        error: "NO_MODULES_CONTAINER",
      });
    }
    return;
  }

  const moduleNameStr = String(moduleName);
  this.isPreviewLoading = true;
  try {
    if (debugEnabled) {
      logger.log(`🎨 [PREVIEW] Setting preview module name: ${moduleNameStr}`);
    }
    this.previewModuleName = moduleName;
    const previewKey = `preview_${moduleNameStr}`;

    const src = await this.loadWorkspaceModuleSource(moduleName);
    if (token !== this.previewToken) {
      sendPreviewCancelled();
      return;
    }
    const moduleSources = { [moduleNameStr]: { text: src?.text || "" } };

    if (this.activeTrack?.name) {
      this.restoreTrackNameAfterPreview = this.activeTrack.name;
    } else {
      this.restoreTrackNameAfterPreview = inheritedRestoreTrackName || null;
    }

    if (this.restoreTrackNameAfterPreview) {
      this.deactivateActiveTrack();
    }

    try {
      this.trackSandboxHost?.destroy?.();
    } catch {}
    this.trackSandboxHost = new TrackSandboxHost(modulesContainer);
    this.trackModuleSources = moduleSources;

    await this.trackSandboxHost.ensureSandbox();
    if (token !== this.previewToken) {
      try {
        this.trackSandboxHost?.destroy?.();
      } catch {}
      this.trackSandboxHost = null;
      this.trackModuleSources = null;
      sendPreviewCancelled();
      return;
    }
    const assetsBaseUrl = this.getAssetsBaseUrlForSandboxToken(this.trackSandboxHost.token);
    if (!assetsBaseUrl) throw new Error("ASSETS_BASE_URL_UNAVAILABLE");

    const track = {
      name: `preview:${moduleNameStr}`,
      modules: [{ id: previewKey, type: moduleNameStr }],
      modulesData: {
        [previewKey]: {
          constructor: Array.isArray((moduleData as { constructor?: unknown } | null)?.constructor)
            ? (moduleData as { constructor: unknown[] }).constructor
            : [],
        },
      },
    };

    if (token !== this.previewToken) {
      try {
        this.trackSandboxHost?.destroy?.();
      } catch {}
      this.trackSandboxHost = null;
      this.trackModuleSources = null;
      sendPreviewCancelled();
      return;
    }

    const res = await this.trackSandboxHost.initTrack({
      track,
      moduleSources,
      assetsBaseUrl,
    });
    if (!res || typeof res !== "object" || (res as { ok?: unknown }).ok !== true) {
      throw new Error(
        String(
          (res as { error?: unknown } | null)?.error || "SANDBOX_PREVIEW_INIT_FAILED"
        )
      );
    }
    if (token !== this.previewToken) {
      this.clearPreviewForModule(moduleName, { restoreTrack: false });
      sendPreviewCancelled();
      if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }
    this.activeModules[previewKey] = [{}];

    if (token !== this.previewToken) {
      this.clearPreviewForModule(moduleName, { restoreTrack: false });
      sendPreviewCancelled();
      if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    if (debugEnabled) {
      logger.log(`✅✅✅ [PREVIEW] Preview active for: ${moduleNameStr}`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }

    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-ready", {
        moduleName,
        requestId,
      });
    }
  } catch (error) {
    logger.error(`❌ [PREVIEW] Error instantiating module "${moduleNameStr}":`, error);
    logger.error(
      `❌ [PREVIEW] Error stack:`,
      (error as { stack?: unknown } | null)?.stack
    );

    this.clearPreviewForModule(moduleName, { restoreTrack: false });

    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-error", {
        moduleName,
        requestId,
        error: (error as { message?: unknown } | null)?.message || "PREVIEW_FAILED",
      });
    }
  } finally {
    if (this.previewToken === token) {
      this.isPreviewLoading = false;
    }
    if (this.deferredClearPreviewToken === token && this.previewModuleName === moduleName) {
      this.deferredClearPreviewToken = null;
      this.clearPreviewForModule(moduleName, { restoreTrack: true });
    }
  }
}

export function clearPreview(this: PreviewControllerContext) {
  if (this.isPreviewLoading) {
    this.deferredClearPreviewToken = this.previewToken;
    return;
  }
  this.previewToken++;
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) logger.log(`🧹 [PREVIEW] clearPreview called`);

  if (!this.previewModuleName) {
    if (debugEnabled) logger.log(`🧹 [PREVIEW] No preview module to clear`);
    return;
  }

  const moduleName = this.previewModuleName;
  this.clearPreviewForModule(moduleName, { restoreTrack: true });
}

export function clearPreviewForModule(
  this: PreviewControllerContext,
  moduleName: unknown,
  options: { restoreTrack?: boolean } = {}
) {
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) logger.log(`🧹 [PREVIEW] Clearing preview for: ${moduleName}`);

  const modulesContainer = document.querySelector(".modules");
  if (!modulesContainer) {
    logger.error("❌ [PREVIEW] No .modules container found");
    if (this.previewModuleName === moduleName) {
      this.previewModuleName = null;
    }
    return;
  }

  const previewKey = `preview_${String(moduleName)}`;
  try {
    this.trackSandboxHost?.destroy?.();
  } catch {}
  this.trackSandboxHost = null;
  this.trackModuleSources = null;
  try {
    modulesContainer.textContent = "";
  } catch {}

  if (this.activeModules[previewKey]) {
    delete this.activeModules[previewKey];
  }
  if (this.previewModuleName === moduleName) {
    this.previewModuleName = null;
  }
  if (this.deferredClearPreviewToken === this.previewToken) {
    this.deferredClearPreviewToken = null;
  }
  if (debugEnabled) logger.log(`✅✅✅ [PREVIEW] Preview cleared successfully`);

  const shouldRestoreTrack = options.restoreTrack !== false;
  const restore = shouldRestoreTrack ? this.restoreTrackNameAfterPreview : null;
  if (shouldRestoreTrack) {
    this.restoreTrackNameAfterPreview = null;
  }
  if (restore) {
    this.activeTrack = null;
    this.handleTrackSelection(restore);
  }
}

export async function triggerPreviewMethod(
  this: PreviewControllerContext,
  moduleName: unknown,
  methodName: unknown,
  options: unknown
) {
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(
      `🎯 [PREVIEW] Triggering method "${methodName}" on preview: ${moduleName}`
    );
    logger.log(`🎯 [PREVIEW] Options:`, options);
  }

  if (!this.previewModuleName || this.previewModuleName !== moduleName) {
    logger.error(`❌ [PREVIEW] No active preview for module: ${moduleName}`);
    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    return;
  }

  const previewKey = `preview_${String(moduleName)}`;
  const host = this.trackSandboxHost;
  if (!host) return;

  try {
    const res = await host.invokeOnInstance?.(previewKey, methodName, options);
    if (!res || typeof res !== "object" || (res as { ok?: unknown }).ok !== true) {
      throw new Error(
        String(
          (res as { error?: unknown } | null)?.error || "SANDBOX_PREVIEW_INVOKE_FAILED"
        )
      );
    }
    if (debugEnabled) {
      logger.log(`✅✅✅ [PREVIEW] Method trigger completed`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  } catch (error) {
    logger.error(`❌ [PREVIEW] Error triggering method "${methodName}":`, error);
    logger.error(
      `❌ [PREVIEW] Error stack:`,
      (error as { stack?: unknown } | null)?.stack
    );
    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

