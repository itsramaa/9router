import 'open-sse/index.js';

import {
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from '../services/auth.js';

import { cacheClaudeHeaders } from 'open-sse/utils/claudeHeaderCache.js';

import { getSettings } from '@/lib/localDb';

import { getModelInfo, getComboModels } from '../services/model.js';

import { handleChatCore } from 'open-sse/handlers/chatCore.js';

import { errorResponse } from 'open-sse/utils/error.js';

import { handleComboChat, handleFusionChat } from 'open-sse/services/combo.js';

import { handleBypassRequest } from 'open-sse/utils/bypassHandler.js';

import { HTTP_STATUS } from 'open-sse/config/runtimeConfig.js';

import { detectFormatByEndpoint } from 'open-sse/translator/formats.js';

import * as log from '../utils/logger.js';

import {
  updateProviderCredentials,
  checkAndRefreshToken,
} from '../services/tokenRefresh.js';

import { getProjectIdForConnection } from 'open-sse/services/projectId.js';

import { runWithFallback } from '../services/fallbackOrchestrator.js';
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";

/**

 * Handle chat completion request

 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats

 */

export async function handleChat(request, clientRawRequest = null) {
  let body;

  try {
    body = await request.json();
  } catch {
    log.warn('CHAT', 'Invalid JSON body');

    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid JSON body');
  }

  if (!clientRawRequest) {
    const url = new URL(request.url);

    clientRawRequest = {
      endpoint: url.pathname,

      body,

      headers: Object.fromEntries(request.headers.entries()),
    };
  }

  cacheClaudeHeaders(clientRawRequest.headers);

  const url = new URL(request.url);

  const modelStr = body.model;

  const msgCount = body.messages?.length || body.input?.length || 0;

  const toolCount = body.tools?.length || 0;

  const effort = body.reasoning_effort || body.reasoning?.effort || null;

  log.request(
    'POST',
    `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ''}${effort ? ` | effort=${effort}` : ''}`
  );

  const authHeader = request.headers.get('Authorization');

  const apiKey = extractApiKey(request);

  if (authHeader && apiKey) {
    log.debug('AUTH', `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug('AUTH', 'No API key provided (local mode)');
  }

  const settings = await getSettings();

  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn('AUTH', 'Missing API key (requireApiKey=true)');

      return errorResponse(HTTP_STATUS.UNAUTHORIZED, 'Missing API key');
    }

    const valid = await isValidApiKey(apiKey);

    if (!valid) {
      log.warn('AUTH', 'Invalid API key (requireApiKey=true)');

      return errorResponse(HTTP_STATUS.UNAUTHORIZED, 'Invalid API key');
    }
  }

  if (!modelStr) {
    log.warn('CHAT', 'Missing model');

    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Missing model');
  }

  const userAgent = request?.headers?.get('user-agent') || '';

  const bypassResponse = handleBypassRequest(
    body,
    modelStr,
    userAgent,
    !!settings.ccFilterNaming
  );

  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const comboModels = await getComboModels(modelStr);

  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};

    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;

    const comboStrategy =
      comboSpecificStrategy || settings.comboStrategy || 'fallback';

    if (comboStrategy === 'fusion') {
      log.info(
        'CHAT',
        `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`
      );

      return handleFusionChat({
        body,

        models: comboModels,

        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;

          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } =
              clientRawRequest.body || {};

            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }

          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },

        log,

        comboName: modelStr,

        judgeModel: comboStrategies[modelStr]?.judgeModel,

        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;

    log.info(
      'CHAT',
      `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`
    );

    return handleComboChat({
      body,

      models: comboModels,

      handleSingleModel: (b, m) =>
        handleSingleModelChat(b, m, clientRawRequest, request, apiKey),

      log,

      comboName: modelStr,

      comboStrategy,

      comboStickyLimit,
    });
  }

  return handleSingleModelChat(
    body,
    modelStr,
    clientRawRequest,
    request,
    apiKey
  );
}

/**

 * Handle single model chat request — uses FallbackOrchestrator for retry loop.

 */

async function handleSingleModelChat(
  body,
  modelStr,
  clientRawRequest = null,
  request = null,
  apiKey = null
) {
  const modelInfo = await getModelInfo(modelStr);

  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);

    if (comboModels) {
      const chatSettings = await getSettings();

      const comboStrategies = chatSettings.comboStrategies || {};

      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;

      const comboStrategy =
        comboSpecificStrategy || chatSettings.comboStrategy || 'fallback';

      if (comboStrategy === 'fusion') {
        log.info(
          'CHAT',
          `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`
        );

        return handleFusionChat({
          body,

          models: comboModels,

          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;

            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } =
                clientRawRequest.body || {};

              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }

            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },

          log,

          comboName: modelStr,

          judgeModel: comboStrategies[modelStr]?.judgeModel,

          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;

      log.info(
        'CHAT',
        `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`
      );

      return handleComboChat({
        body,

        models: comboModels,

        handleSingleModel: (b, m) =>
          handleSingleModelChat(b, m, clientRawRequest, request, apiKey),

        log,

        comboName: modelStr,

        comboStrategy,

        comboStickyLimit,
      });
    }

    log.warn('CHAT', 'Invalid model format', { model: modelStr });

    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid model format');
  }

  const { provider, model } = modelInfo;

  if (modelStr !== `${provider}/${model}`) {
    log.info('ROUTING', `${modelStr} → ${provider}/${model}`);
  } else {
    log.info('ROUTING', `Provider: ${provider}, Model: ${model}`);
  }

  const userAgent = request?.headers?.get('user-agent') || '';

  return runWithFallback({
    provider,

    model,

    logPrefix: `${provider}/${model}`,

    // Hook: token refresh + projectId resolve before execute

    onCredentialsSelected: async (credentials) => {
      const refreshed = await checkAndRefreshToken(provider, credentials);

      // Ensure real project ID for antigravity/gemini-cli on cold miss

      if (
        (provider === 'antigravity' || provider === 'gemini-cli') &&
        !refreshed.projectId
      ) {
        const pid = await getProjectIdForConnection(
          credentials.connectionId,
          refreshed.accessToken
        );

        if (pid) {
          refreshed.projectId = pid;

          updateProviderCredentials(credentials.connectionId, {
            projectId: pid,
          }).catch(() => {});
        }
      }

      return refreshed;
    },

    execute: async (credentials) => {
      const chatSettings = await getSettings();

      const providerThinking =
        (chatSettings.providerThinking || {})[provider] || null;

      return handleChatCore({
        body: { ...body, model: `${provider}/${model}` },

        modelInfo: { provider, model },

        credentials,

        log,

        clientRawRequest,

        connectionId: credentials.connectionId,

        userAgent,

        apiKey,

        ccFilterNaming: !!chatSettings.ccFilterNaming,

        rtkEnabled: !!chatSettings.rtkEnabled,

        headroomEnabled: !!chatSettings.headroomEnabled,

        headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,

        headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,

        cavemanEnabled: !!chatSettings.cavemanEnabled,

        cavemanLevel: chatSettings.cavemanLevel || 'full',

        ponytailEnabled: !!chatSettings.ponytailEnabled,

        ponytailLevel: chatSettings.ponytailLevel || 'full',

        providerThinking,

        sourceFormatOverride: request?.url
          ? detectFormatByEndpoint(new URL(request.url).pathname, body)
          : null,

        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(credentials.connectionId, {
            ...newCreds,

            existingProviderSpecificData: credentials.providerSpecificData,

            testStatus: 'active',
          });
        },

        // BUG-19 fix: removed onRequestSuccess — clearAccountError is called by
        // onSuccess in runWithFallback to avoid double DB write per request
      });
    },

    onSuccess: async (credentials) => {
      await clearAccountError(credentials.connectionId, credentials, model);
    },
  });
}
