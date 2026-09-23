import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import {
  buildChatAgentModel as buildOpenRouterModel,
} from "./openrouter";

// Fork: route the SAM in-app agent through any OpenAI-compatible chat
// endpoint (Cloudflare Workers AI, Kiro Prism, ...) when CHAT_AGENT_API_KEY
// is set; otherwise keep the upstream OpenRouter path untouched.
const DEFAULT_CHAT_AGENT_MODEL = "@cf/zai-org/glm-5.3";

export type ChatAgentEnv = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  CHAT_AGENT_BASE_URL?: string;
  CHAT_AGENT_API_KEY?: string;
  CHAT_AGENT_MODEL?: string;
};

export function hasChatAgentKey(env: ChatAgentEnv): boolean {
  return Boolean(env.CHAT_AGENT_API_KEY ?? env.OPENROUTER_API_KEY);
}

/**
 * Returns the AI SDK LanguageModel for the chat agent.
 *
 * OpenAI-compatible path: `.chat()` targets `{baseURL}/chat/completions`
 * (e.g. `https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`).
 * @ai-sdk/openai v3 takes per-model options (reasoning effort) only via
 * per-call providerOptions, which Think controls — so the effort hint is
 * intentionally dropped here and the model self-manages reasoning.
 *
 * Sync on purpose, like the OpenRouter builder: Think's `getModel()` hook
 * is sync and runs on every turn.
 */
export function buildChatAgentModel(
  env: ChatAgentEnv,
  reasoningEffort: "max" | "low" = "max",
): LanguageModelV3 {
  const baseUrl = env.CHAT_AGENT_BASE_URL?.trim();
  const apiKey = env.CHAT_AGENT_API_KEY?.trim();
  if (apiKey && baseUrl) {
    return createOpenAI({ apiKey, baseURL: baseUrl }).chat(
      env.CHAT_AGENT_MODEL?.trim() || DEFAULT_CHAT_AGENT_MODEL,
    );
  }
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "CHAT_AGENT_API_KEY (or OPENROUTER_API_KEY) is required for the SAM agent",
    );
  }
  return buildOpenRouterModel(
    env.OPENROUTER_API_KEY,
    env.OPENROUTER_MODEL,
    reasoningEffort,
  );
}
