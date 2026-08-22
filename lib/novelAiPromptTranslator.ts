import type { RuntimeContext } from "./runtimeContext.js";
import { getGrokEndpoint, getPlannerConfig, withTimeoutSignal } from "./grokImageCore.js";
import { grokFetchWithRetry } from "./grokUpstreamRetry.js";
import { logEvent } from "./logger.js";

const NOVELAI_TRANSLATOR_PROMPT = `Translate the user's image prompt into English for NovelAI Diffusion V4.5.
Preserve every requested subject, action, relationship, visual detail, proper name, and any literal text to render.
Keep existing English tags when useful. Express the result as a concise, comma-separated NovelAI image prompt.
Do not add commentary, Markdown, quotation marks, or explanations. Return only the final English prompt.`;

type ChatCompletionBody = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: string | { message?: string };
};

function translationError(message: string, status: number, code: string): Error {
  const error = new Error(message) as Error & { status?: number; code?: string; isOperational?: boolean };
  error.status = status;
  error.code = code;
  error.isOperational = true;
  return error;
}

function cleanTranslatedPrompt(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return (fenced?.[1] || trimmed).trim();
}

export async function translateNovelAiPromptWithGrok(
  prompt: string,
  ctx: RuntimeContext,
  options: { signal?: AbortSignal; requestId?: string } = {},
): Promise<{ prompt: string; model: string }> {
  const planner = getPlannerConfig(ctx);
  const { url, headers } = getGrokEndpoint(ctx, "/v1/chat/completions");
  const { combinedSignal, timer } = withTimeoutSignal(options.signal, planner.timeoutMs);

  logEvent("novelai", "translate:start", {
    requestId: options.requestId,
    translator: "grok",
    model: planner.model,
    promptChars: prompt.length,
  });

  try {
    const response = await grokFetchWithRetry(() => fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: planner.model,
        stream: false,
        temperature: 0.2,
        messages: [
          { role: "system", content: NOVELAI_TRANSLATOR_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
      signal: combinedSignal,
    }), { signal: combinedSignal, label: "novelai-translation" });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let detail = raw || response.statusText || `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(raw) as ChatCompletionBody;
        detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || detail;
      } catch {
        // Keep the plain-text upstream error.
      }
      const status = response.status === 401 || response.status === 403 ? 401 : 502;
      const code = status === 401 ? "NOVELAI_GROK_AUTH_FAILED" : "NOVELAI_GROK_TRANSLATION_FAILED";
      throw translationError(`Grok prompt translation failed: ${detail}`, status, code);
    }

    const body = await response.json() as ChatCompletionBody;
    const translatedPrompt = cleanTranslatedPrompt(body.choices?.[0]?.message?.content || "");
    if (!translatedPrompt) {
      throw translationError("Grok returned an empty NovelAI prompt", 502, "NOVELAI_GROK_TRANSLATION_EMPTY");
    }

    logEvent("novelai", "translate:done", {
      requestId: options.requestId,
      translator: "grok",
      model: planner.model,
      promptChars: translatedPrompt.length,
    });
    return { prompt: translatedPrompt, model: planner.model };
  } catch (cause) {
    if ((cause as { code?: string }).code?.startsWith("NOVELAI_GROK_")) throw cause;
    if ((cause as { name?: string }).name === "AbortError" || (cause as { name?: string }).name === "TimeoutError") {
      const canceled = options.signal?.aborted;
      throw translationError(
        canceled ? "Grok prompt translation was canceled" : "Grok prompt translation timed out",
        canceled ? 499 : 504,
        canceled ? "GENERATION_CANCELED" : "NOVELAI_GROK_TRANSLATION_TIMEOUT",
      );
    }
    throw translationError(
      `Grok prompt translation request failed: ${(cause as Error).message}`,
      502,
      "NOVELAI_GROK_TRANSLATION_NETWORK_FAILED",
    );
  } finally {
    clearTimeout(timer);
  }
}
