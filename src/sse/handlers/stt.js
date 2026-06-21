import {
  extractApiKey,
  isValidApiKey,
  clearAccountError,
} from '../services/auth.js';

import { getSettings } from '@/lib/localDb';

import { getModelInfo } from '../services/model.js';

import { handleSttCore } from 'open-sse/handlers/sttCore.js';

import { errorResponse } from 'open-sse/utils/error.js';

import { HTTP_STATUS } from 'open-sse/config/runtimeConfig.js';

import { AI_PROVIDERS } from '@/shared/constants/providers';

import * as log from '../utils/logger.js';

import { runWithFallback } from '../services/fallbackOrchestrator.js';

const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)

    .filter(
      ([, p]) =>
        p.serviceKinds?.includes('stt') &&
        !p.noAuth &&
        p.sttConfig?.authType !== 'none'
    )

    .map(([id]) => id)
);

export async function handleStt(request) {
  let formData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,

      'Invalid multipart form data'
    );
  }

  const modelStr = formData.get('model');

  log.request('POST', `/v1/audio/transcriptions | ${modelStr}`);

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

  if (!formData.get('file'))
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,

      'Missing required field: file'
    );

  const modelInfo = await getModelInfo(modelStr);

  if (!modelInfo.provider)
    return errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid model format');

  const { provider, model } = modelInfo;

  log.info('ROUTING', `Provider: ${provider}, Model: ${model}`);

  // noAuth providers bypass fallback orchestrator

  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleSttCore({
      provider,

      model,

      formData,

      sttConfig: AI_PROVIDERS[provider]?.sttConfig,
    });

    if (result.success) return result.response;

    return errorResponse(
      result.status || HTTP_STATUS.BAD_GATEWAY,

      result.error || 'STT failed'
    );
  }

  return runWithFallback({
    provider,

    model,

    execute: async (credentials) =>
      handleSttCore({
        provider,

        model,

        formData,

        credentials,

        sttConfig: AI_PROVIDERS[provider]?.sttConfig,
      }),

    // BUG-16 fix: clear error state on successful STT request

    onSuccess: async (credentials) => {
      await clearAccountError(credentials.connectionId, credentials);
    },
  });
}
