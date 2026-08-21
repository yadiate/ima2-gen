// lib/novelAiImageAdapter.ts — NovelAI Diffusion image-generation adapter.

import type { RuntimeContext } from "./runtimeContext.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { logEvent } from "./logger.js";

export const NOVELAI_DEFAULT_IMAGE_MODEL = "nai-diffusion-4-5-full";
const NOVELAI_GENERATE_URL = "https://image.novelai.net/ai/generate-image";
const DEFAULT_NEGATIVE_PROMPT = "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, watermark";

type NovelAiGenerateOptions = {
  model?: string | undefined;
  size?: string | undefined;
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  references?: Array<{ b64: string }> | undefined;
};

type NovelAiImageResult = {
  b64: string;
  revisedPrompt: null;
  usage: null;
  webSearchCalls: number;
  mime: string;
  effectiveModel: string;
};

function novelAiError(message: string, status: number, code: string): Error {
  const error = new Error(message) as Error & { status?: number; code?: string; isOperational?: boolean };
  error.status = status;
  error.code = code;
  error.isOperational = true;
  return error;
}

function resolveSize(value?: string): { width: number; height: number } {
  const match = value?.match(/^(\d+)x(\d+)$/);
  if (!match) return { width: 1024, height: 1024 };
  const normalize = (dimension: number) => Math.max(64, Math.min(2048, Math.round(dimension / 64) * 64));
  return { width: normalize(Number(match[1])), height: normalize(Number(match[2])) };
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string; error?: string; detail?: string };
    return body.message || body.error || body.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function generateViaNovelAi(
  prompt: string,
  ctx: RuntimeContext,
  options: NovelAiGenerateOptions = {},
): Promise<NovelAiImageResult> {
  if (!ctx.novelAiApiKey) {
    throw novelAiError("NovelAI API key not configured", 401, "NOVELAI_API_KEY_MISSING");
  }
  if ((options.references || []).some((reference) => reference.b64)) {
    throw novelAiError("NovelAI references are not supported yet", 400, "NOVELAI_REFERENCES_UNSUPPORTED");
  }

  const model = options.model || NOVELAI_DEFAULT_IMAGE_MODEL;
  const { width, height } = resolveSize(options.size);
  const negativePrompt = DEFAULT_NEGATIVE_PROMPT;
  const requestBody = {
    action: "generate",
    input: prompt,
    model,
    parameters: {
      params_version: 3,
      width,
      height,
      scale: 5,
      sampler: "k_euler_ancestral",
      steps: 28,
      n_samples: 1,
      seed: Math.floor(Math.random() * 0xffff_ffff),
      negative_prompt: negativePrompt,
      qualityToggle: true,
      ucPreset: 0,
      cfg_rescale: 0,
      noise_schedule: "karras",
      v4_prompt: {
        caption: { base_caption: prompt, char_captions: [] },
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negativePrompt, char_captions: [] },
        legacy_uc: false,
      },
    },
  };

  logEvent("novelai", "generate:start", { requestId: options.requestId, model, width, height });
  try {
    const response = await fetch(NOVELAI_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.novelAiApiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: options.signal || AbortSignal.timeout(ctx.config.novelAiProvider.generationTimeoutMs),
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      if (response.status === 401 || response.status === 403) {
        throw novelAiError(`NovelAI authentication failed: ${detail}`, 401, "NOVELAI_AUTH_FAILED");
      }
      if (response.status === 402) {
        throw novelAiError(`NovelAI insufficient Anlas: ${detail}`, 402, "NOVELAI_INSUFFICIENT_BALANCE");
      }
      if (response.status === 429) {
        throw novelAiError(`NovelAI rate limited: ${detail}`, 429, "NOVELAI_RATE_LIMITED");
      }
      throw novelAiError(`NovelAI generation failed (${response.status}): ${detail}`, 502, "NOVELAI_UPSTREAM_ERROR");
    }

    const payload = await response.json() as { images?: Array<{ image?: string }> };
    const b64 = payload.images?.[0]?.image;
    if (!b64) throw novelAiError("NovelAI returned no image", 502, "NOVELAI_EMPTY_IMAGE");
    const mime = detectImageMimeFromB64(b64);
    if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      throw novelAiError("NovelAI returned invalid image bytes", 502, "NOVELAI_IMAGE_INVALID");
    }
    logEvent("novelai", "generate:done", { requestId: options.requestId, model, width, height });
    return { b64, revisedPrompt: null, usage: null, webSearchCalls: 0, mime, effectiveModel: model };
  } catch (cause) {
    if ((cause as { code?: string }).code?.startsWith("NOVELAI_")) throw cause;
    if ((cause as { name?: string }).name === "AbortError" || (cause as { name?: string }).name === "TimeoutError") {
      throw novelAiError("NovelAI generation timed out or was canceled", 504, "NOVELAI_TIMEOUT");
    }
    throw novelAiError(`NovelAI request failed: ${(cause as Error).message}`, 502, "NOVELAI_NETWORK_FAILED");
  }
}
