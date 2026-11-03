import { find, forEach, isEqual, isFunction } from "lodash";
import logger from "../../helpers/logger";
import { TrackSandboxHost } from "../sandbox/TrackSandboxHost";
import { getMessaging } from "../bridge";

const notifyProjectorReady = () => {
  const messaging = getMessaging();
  messaging?.sendToDashboard?.("projector-ready", {});
  logger.log("✅ [PROJECTOR-IPC] Sent projector-ready signal to dashboard");
};

export function deactivateActiveTrack() {
  if (!this.activeTrack || this.isDeactivating) return;
  this.isDeactivating = true;

  const modulesContainer = document.querySelector(".modules");
  if (!modulesContainer) {
    this.isDeactivating = false;
    return;
  }

  try {
    this.trackSandboxHost?.destroy?.();
  } catch {}
  this.trackSandboxHost = null;

  forEach(this.activeModules, (instances, instanceId) => {
    forEach(instances, (instance) => {
      if (isFunction(instance.destroy)) {
        try {
          instance.destroy();
        } catch (error) {
          console.error(`Error during destroy of instance "${instanceId}":`, error);
        }
      }
    });
  });

  try {
    modulesContainer.textContent = "";
  } catch {}

  this.activeModules = {};
  this.activeTrack = null;
  this.activeChannelHandlers = {};
  try {
    this.runtimeMatrixOverrides = new Map();
  } catch {}
  this.isDeactivating = false;
}

export async function handleTrackSelection(trackName) {
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) {
    logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.log("📦 [TRACK] handleTrackSelection called with:", trackName);
    logger.log("📦 [TRACK] Current userData:", this.userData);
    logger.log("📦 [TRACK] Looking for track with name:", trackName);
  }

  const safeTrackName = trackName != null ? String(trackName).trim() : "";
  if (safeTrackName) {
    this.lastRequestedTrackName = safeTrackName;
  }

  if (this.isLoadingTrack) {
    if (this.activeTrack?.name === trackName) {
      if (debugEnabled) {
        logger.log("⚠️ [TRACK] Already loading this track, ignoring duplicate request");
      }
      return;
    }
    if (debugEnabled) {
      logger.log(`⚠️ [TRACK] Track load in progress, queueing "${trackName}" as pending`);
    }
    this.pendingTrackName = trackName;
    return;
  }

  const finalizeLoadCycle = () => {
    if (this.pendingTrackName) {
      const nextTrack = this.pendingTrackName;
      this.pendingTrackName = null;
      if (debugEnabled) logger.log(`🔄 [TRACK] Loading pending track: "${nextTrack}"`);
      this.handleTrackSelection(nextTrack);
      return;
    }

    if (this.pendingReloadData) {
      const pending = this.pendingReloadData;
      this.pendingReloadData = null;
      this.loadUserData(pending.setId);
      this.applyConfigSettings();
      if (pending.trackName) {
        const nextTrack = find(this.userData, { name: pending.trackName });
        if (
          this.activeTrack &&
          this.activeTrack.name === pending.trackName &&
          nextTrack
        ) {
          const activeModules = Array.isArray(this.activeTrack.modules)
            ? this.activeTrack.modules.filter((m) => !m.disabled)
            : [];
          const nextModules = Array.isArray(nextTrack.modules)
            ? nextTrack.modules.filter((m) => !m.disabled)
            : [];
          if (
            isEqual(
              {
                name: this.activeTrack.name,
                modules: activeModules,
                modulesData: this.activeTrack.modulesData,
                channelMappings: this.activeTrack.channelMappings,
              },
              {
                name: nextTrack.name,
                modules: nextModules,
                modulesData: nextTrack.modulesData,
                channelMappings: nextTrack.channelMappings,
              }
            )
          ) {
            // no-op
          } else {
            this.deactivateActiveTrack();
            this.handleTrackSelection(pending.trackName);
            return;
          }
        } else {
          this.deactivateActiveTrack();
          this.handleTrackSelection(pending.trackName);
          return;
        }
      }
    }

    if (this.pendingWorkspaceReload === true) {
      this.pendingWorkspaceReload = false;
      const nextTrackName =
        (this.activeTrack && this.activeTrack.name) || this.lastRequestedTrackName || null;
      if (nextTrackName) {
        this.deactivateActiveTrack();
        this.handleTrackSelection(nextTrackName);
        return;
      }
    }

    notifyProjectorReady();
  };

  const finishLoadCycle = () => {
    this.isLoadingTrack = false;
    finalizeLoadCycle();
  };

  this.isLoadingTrack = true;
  this.setRenderStatus?.("loading");

  const track = find(this.userData, { name: trackName });
  if (debugEnabled) logger.log("📦 [TRACK] Track found:", track);

  if (!track) {
    logger.error(`❌ [TRACK] Track "${trackName}" not found in userData`);
    if (debugEnabled) {
      logger.log(
        "📦 [TRACK] Available tracks:",
        this.userData.map((t) => t.name)
      );
    }
    this.deactivateActiveTrack();
    this.setRenderStatus?.("error", `Track "${String(trackName || "")}" not found`);
    return finishLoadCycle();
  }

  if (debugEnabled) logger.log("📦 [TRACK] Current activeTrack:", this.activeTrack);

  const filteredTrack = {
    ...track,
    modules: Array.isArray(track.modules)
      ? track.modules.filter((m) => !m.disabled)
      : track.modules,
  };

  if (this.activeTrack && this.activeTrack.name !== trackName) {
    if (debugEnabled) {
      logger.log("📦 [TRACK] Deactivating previous track:", this.activeTrack.name);
    }
    this.deactivateActiveTrack();
  }

  if (this.activeTrack?.name === trackName) {
    const activeModules = Array.isArray(this.activeTrack.modules)
      ? this.activeTrack.modules.filter((m) => !m.disabled)
      : [];
    const filteredModules = Array.isArray(filteredTrack.modules)
      ? filteredTrack.modules
      : [];
    if (
      activeModules.length === filteredModules.length &&
      activeModules.every(
        (m, i) =>
          m.id === filteredModules[i]?.id &&
          m.type === filteredModules[i]?.type
      )
    ) {
      if (debugEnabled)
        logger.log("⚠️ [TRACK] Track already active with same enabled modules, skipping");
      this.setRenderStatus?.("ready");
      return finishLoadCycle();
    }
  }

  const modulesContainer = document.querySelector(".modules");
  if (debugEnabled) logger.log("📦 [TRACK] Modules container:", modulesContainer);

  if (!modulesContainer) {
    logger.error("❌ [TRACK] No .modules container found in DOM!");
    this.setRenderStatus?.("error", "No module container available");
    return finishLoadCycle();
  }

  if (debugEnabled) logger.log("📦 [TRACK] Track modules to load:", filteredTrack.modules);

  if (!Array.isArray(filteredTrack.modules)) {
    logger.error(`❌ [TRACK] Track "${trackName}" has invalid modules array:`, filteredTrack.modules);
    if (debugEnabled) logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    this.setRenderStatus?.("error", "Track has invalid module configuration");
    return finishLoadCycle();
  }

  if (filteredTrack.modules.length === 0) {
    this.deactivateActiveTrack();
    this.activeTrack = filteredTrack;
    this.activeChannelHandlers = this.buildChannelHandlerMap(filteredTrack);
    this.activeModules = {};
    this.trackModuleSources = {};
    this.setRenderStatus?.("empty", "No enabled modules");
    return finishLoadCycle();
  }

  if (!this.workspacePath) {
    if (debugEnabled) {
      logger.log("⚠️ [TRACK] Skipping track activation without workspace path");
    }
    this.deactivateActiveTrack();
    this.activeTrack = filteredTrack;
    this.activeChannelHandlers = this.buildChannelHandlerMap(filteredTrack);
    this.activeModules = {};
    this.trackModuleSources = {};
    this.setRenderStatus?.("empty", "Open project folder to load modules");
    return finishLoadCycle();
  }

  try {
    this.activeTrack = filteredTrack;
    this.activeChannelHandlers = this.buildChannelHandlerMap(filteredTrack);

    const moduleSources = {};
    const seenTypes = new Set();
    for (const m of filteredTrack.modules) {
      const t = String(m?.type || "").trim();
      if (!t || seenTypes.has(t)) continue;
      seenTypes.add(t);
      const src = await this.loadWorkspaceModuleSource(t);
      moduleSources[t] = { text: src?.text || "" };
    }
    this.trackModuleSources = moduleSources;
    const moduleTypeList = Array.from(seenTypes);

    if (!this.trackSandboxHost) {
      this.trackSandboxHost = new TrackSandboxHost(modulesContainer);
    }

    await this.trackSandboxHost.ensureSandbox();
    const assetsBaseUrl = this.getAssetsBaseUrlForSandboxToken(this.trackSandboxHost.token);
    if (!assetsBaseUrl) {
      throw new Error("ASSETS_BASE_URL_UNAVAILABLE");
    }

    if (debugEnabled) logger.log("⏳ [TRACK] Waiting for sandbox track init...");
    const res = await this.trackSandboxHost.initTrack({
      track: filteredTrack,
      moduleSources,
      assetsBaseUrl,
    });
    if (!res || res.ok !== true) {
      const resObj = res && typeof res === "object" ? res : {};
      const failedModuleType =
        resObj && typeof resObj.moduleType === "string" ? String(resObj.moduleType) : "";
      if (failedModuleType) {
        try {
          const messaging = getMessaging();
          messaging?.sendToDashboard?.("workspace-modules-failed", {
            moduleIds: [failedModuleType],
            trackName,
            error: String(resObj.error || "SANDBOX_TRACK_INIT_FAILED"),
          });
        } catch {}
      }
      throw new Error(res?.error || "SANDBOX_TRACK_INIT_FAILED");
    }
    try {
      const messaging = getMessaging();
      if (moduleTypeList.length) {
        messaging?.sendToDashboard?.("workspace-modules-loaded", {
          moduleIds: moduleTypeList,
          trackName,
        });
      }
    } catch {}

    this.activeModules = {};
    for (const m of filteredTrack.modules) {
      const instanceId = String(m?.id || "").trim();
      if (!instanceId) continue;
      this.activeModules[instanceId] = [{}];
    }
    this.setRenderStatus?.("ready");
    if (debugEnabled) logger.log("✅ [TRACK] Sandbox track initialized");

    if (debugEnabled) {
      logger.log(`✅✅✅ [TRACK] Track activated successfully: "${trackName}"`);
      logger.log("📦 [TRACK] Active modules:", Object.keys(this.activeModules));
      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    }
  } catch (error) {
    const errMessage =
      error && typeof error === "object" && "message" in error
        ? String(error.message || "")
        : String(error || "");
    const isExpectedSandboxTeardown =
      errMessage === "SANDBOX_DESTROYED" && !!this.previewModuleName;
    if (isExpectedSandboxTeardown) {
      if (debugEnabled) {
        logger.log(`⚠️ [TRACK] Ignoring expected sandbox teardown during preview transition`);
      }
      this.setRenderStatus?.("ready");
    } else {
      logger.error(`❌ [TRACK] Failed to activate track "${trackName}":`, error);
      this.setRenderStatus?.("error", errMessage || "Track failed to load");
    }
    this.deactivateActiveTrack();
  } finally {
    this.isLoadingTrack = false;
  }
  finalizeLoadCycle();
}

