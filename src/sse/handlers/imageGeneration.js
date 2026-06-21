import {
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";
import { runWithFallback } from "../services/fallbackOrchestrator.js";

const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);

export async function handleImageGeneration(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model;

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[modelStr]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("IMAGE", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelImage(b, m, { wantsStream, binaryOutput, preferredConnectionId }),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelImage(body, modelStr, { wantsStream, binaryOutput, preferredConnectionId });
}

async function handleSingleModelImage(body, modelStr, { wantsStream, binaryOutput, preferredConnectionId } = {}) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;

  // noAuth providers bypass fallback orchestrator
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const result = await handleImageGenerationCore({ body, modelInfo: { provider, model }, credentials: null, binaryOutput });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  return runWithFallback({
    provider,
    model,
    onCredentialsSelected: async (credentials) =>
      checkAndRefreshToken(provider, credentials),
    execute: async (credentials) =>
      handleImageGenerationCore({
        body,
        modelInfo: { provider, model },
        credentials,
        streamToClient: wantsStream,
        binaryOutput,
        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(credentials.connectionId, {
            accessToken: newCreds.accessToken,
            refreshToken: newCreds.refreshToken,
            providerSpecificData: newCreds.providerSpecificData,
            testStatus: "active"
          });
        },
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
        }
      }),
    onSuccess: async (credentials) => {
      await clearAccountError(credentials.connectionId, credentials, model);
    },
  });
}
