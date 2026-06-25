import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

// Models that use /zen/v1/messages (claude format)
const MESSAGES_MODELS = new Set();

// Variasi x-opencode-client — tiap value = bucket rate limit terpisah di upstream
const CLIENT_VARIANTS = [
  "desktop",
  "web",
  "vscode",
  "jetbrains",
  "cli",
  "mobile",
  "neovim",
  "cursor",
];

// User-Agent pool untuk variasi identitas HTTP lebih lanjut
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "OpenCode/1.0 (desktop; linux x64)",
  "OpenCode/1.0 (desktop; darwin arm64)",
];

// Round-robin state
let clientVariantIndex = 0;
let uaIndex = 0;

function pickClientVariant() {
  const v = CLIENT_VARIANTS[clientVariantIndex % CLIENT_VARIANTS.length];
  clientVariantIndex = (clientVariantIndex + 1) % CLIENT_VARIANTS.length;
  return v;
}

function pickUserAgent() {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex = (uaIndex + 1) % USER_AGENTS.length;
  return ua;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "x-opencode-client": pickClientVariant(),
      "User-Agent": pickUserAgent(),
      "Accept": "text/event-stream",
    };
  }
}

export const __test__ = {
  CLIENT_VARIANTS, USER_AGENTS, pickClientVariant, pickUserAgent,
};
