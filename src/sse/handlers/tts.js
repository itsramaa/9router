import { extractApiKey, isValidApiKey } from '../services/auth.js';

import { getSettings } from '@/lib/localDb';

import { getModelInfo, getComboModels } from '../services/model.js';

import { handleTtsCore } from 'open-sse/handlers/ttsCore.js';

import { errorResponse } from 'open-sse/utils/error.js';

import { HTTP_STATUS } from 'open-sse/config/runtimeConfig.js';

import { AI_PROVIDERS } from '@/shared/constants/providers';

import { handleComboChat } from 'open-sse/services/combo.js';

import * as log from '../utils/logger.js';

import { runWithFallback } from '../services/fallbackOrchestrator.js';

const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)

    .filter(
      ([, p]) =>
        p.serviceKinds?.includes('tts') &&
        !p.noAuth &&
        p.ttsConfig?.authType !== 'none'
    )

    .map(([id]) => id)
);

export async function handleTts(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid JSON body');
  }

  const url = new URL(request.url);

  const modelStr = body.model;

  const responseFormat = url.searchParams.get('response_format') || 'mp3';

  const language = body.language || '';

  log.request(
    'POST',
    `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ''}`
  );

  const settings = await getSettings();

  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);

    if (!apiKey)
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, 'Missing API key');

    const valid = await isValidApiKey(apiKey);

    if (!valid)
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, 'Invalid API key');
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Missing model');

  if (!body.input)
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      'Missing required field: input'
    );

  const comboModels = await getComboModels(modelStr);

  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};

    const comboStrategy =
      comboStrategies[modelStr]?.fallbackStrategy ||
      settings.comboStrategy ||
      'fallback';

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;

    log.info(
      'TTS',
      `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`
    );

    return handleComboChat({
      body,

      models: comboModels,

      handleSingleModel: (b, m) =>
        handleSingleModelTts(b, m, responseFormat, language),

      log,

      comboName: modelStr,

      comboStrategy,

      comboStickyLimit,
    });
  }

  return handleSingleModelTts(body, modelStr, responseFormat, language);
}

async function handleSingleModelTts(body, modelStr, responseFormat, language) {
  const modelInfo = await getModelInfo(modelStr);

  if (!modelInfo.provider)
    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid model format');

  const { provider, model } = modelInfo;

  log.info('ROUTING', `Provider: ${provider}, Voice: ${model}`);

  // noAuth providers bypass fallback orchestrator

  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleTtsCore({
      provider,
      model,
      input: body.input,
      responseFormat,
      language,
    });

    if (result.success) return result.response;

    return errorResponse(
      result.status || HTTP_STATUS.BAD_GATEWAY,
      result.error || 'TTS failed'
    );
  }

  return runWithFallback({
    provider,

    model,

    execute: async (credentials) => {
      const result = await handleTtsCore({
        provider,
        model,
        input: body.input,
        credentials,
        responseFormat,
        language,
      });

      return result;
    },

    onSuccess: async () => {},
  });
}
