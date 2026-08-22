// lib/novelAiImageAdapter.ts — NovelAI Diffusion image-generation adapter.

import type { RuntimeContext } from "./runtimeContext.js";
import { unzipSync } from "fflate";
import { detectImageMimeFromB64 } from "./refs.js";
import { logEvent } from "./logger.js";
import { translateNovelAiPromptWithGrok } from "./novelAiPromptTranslator.js";
import {
  combinedNovelAiNegativePrompt,
  normalizeNovelAiOptions,
} from "./novelAiOptions.js";

export const NOVELAI_DEFAULT_IMAGE_MODEL = "nai-diffusion-4-5-full";
const NOVELAI_GENERATE_URL = "https://image.novelai.net/ai/generate-image";

type NovelAiGenerateOptions = {
  model?: string | undefined;
  size?: string | undefined;
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  references?: Array<{ b64: string }> | undefined;
  novelAiOptions?: unknown;
};

type NovelAiImageResult = {
  b64: string;
  revisedPrompt: string;
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

const UC_PRESET_IDS = { heavy: 0, light: 1, furry: 2, human: 3, none: 4 } as const;
const CHARACTER_CENTERS = {
  left: { x: 0.2, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 0.8, y: 0.5 },
} as const;

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string; error?: string; detail?: string };
    return body.message || body.error || body.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function readNovelAiImage(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json() as { images?: Array<{ image?: string }> };
    return payload.images?.[0]?.image;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const archive = unzipSync(bytes);
    const image = Object.entries(archive).find(([name]) => /\.(png|jpe?g|webp)$/i.test(name));
    return image ? Buffer.from(image[1]).toString("base64") : undefined;
  }
  return bytes.length ? Buffer.from(bytes).toString("base64") : undefined;
}

export async function generateViaNovelAi(
  prompt: string,
  ctx: RuntimeContext,
  options: NovelAiGenerateOptions = {},
): Promise<NovelAiImageResult> {
  if (!ctx.novelAiApiKey) {
    throw novelAiError("NovelAI API key not configured", 401, "NOVELAI_API_KEY_MISSING");
  }
  const settings = normalizeNovelAiOptions(options.novelAiOptions);
  const references = (options.references || []).map((reference) => reference.b64).filter(Boolean);
  if (references.length > 0 && settings.referenceMode === "none") {
    throw novelAiError("Choose a NovelAI reference mode for attached images", 400, "NOVELAI_REFERENCE_MODE_REQUIRED");
  }
  if (settings.referenceMode === "img2img" && references.length > 1) {
    throw novelAiError("NovelAI Image2Image accepts one source image", 400, "NOVELAI_IMG2IMG_TOO_MANY_IMAGES");
  }
  const referenceLimit = settings.referenceMode === "vibe" ? 16 : 6;
  if (references.length > referenceLimit) {
    throw novelAiError(`NovelAI ${settings.referenceMode} accepts up to ${referenceLimit} reference images`, 400, "NOVELAI_REFERENCES_TOO_MANY");
  }
  const model = options.model || NOVELAI_DEFAULT_IMAGE_MODEL;
  const { width, height } = resolveSize(options.size);
  const translated = await translateNovelAiPromptWithGrok(prompt, ctx, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    negativePrompt: settings.negativePrompt,
    characters: settings.characters,
  });
  const translatedPrompt = translated.prompt;
  const negativePrompt = combinedNovelAiNegativePrompt(settings, translated.negativePrompt);
  const characterPrompts = settings.characters.map((character, index) => ({
    center: CHARACTER_CENTERS[character.position],
    prompt: translated.characters[index]?.prompt || "",
    uc: translated.characters[index]?.negativePrompt || "",
  }));
  const positiveCharacterCaptions = characterPrompts.map((character) => ({
    centers: [character.center],
    char_caption: character.prompt,
  }));
  const negativeCharacterCaptions = characterPrompts.map((character) => ({
    centers: [character.center],
    char_caption: character.uc,
  }));
  const preciseType = settings.referenceMode.startsWith("precise-")
    ? settings.referenceMode.replace("precise-", "")
    : null;
  const requestBody = {
    action: settings.referenceMode === "img2img" && references.length ? "img2img" : "generate",
    input: translatedPrompt,
    model,
    parameters: {
      params_version: 3,
      width,
      height,
      scale: settings.scale,
      sampler: settings.sampler,
      steps: settings.steps,
      n_samples: 1,
      seed: settings.seed ?? Math.floor(Math.random() * 0xffff_ffff),
      negative_prompt: negativePrompt,
      qualityToggle: settings.qualityTags,
      ucPreset: UC_PRESET_IDS[settings.ucPreset],
      cfg_rescale: settings.cfgRescale,
      noise_schedule: settings.noiseSchedule,
      autoSmea: settings.smea === "auto",
      sm: settings.smea === "smea" || settings.smea === "dynamic",
      sm_dyn: settings.smea === "dynamic",
      dynamic_thresholding: settings.decrisper,
      characterPrompts,
      v4_prompt: {
        caption: { base_caption: translatedPrompt, char_captions: positiveCharacterCaptions },
        use_coords: settings.characters.some((character) => character.position !== "center"),
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negativePrompt, char_captions: negativeCharacterCaptions },
        legacy_uc: false,
      },
      ...(settings.referenceMode === "img2img" && references[0] ? {
        image: references[0],
        strength: settings.img2imgStrength,
        noise: settings.img2imgNoise,
        extra_noise_seed: Math.floor(Math.random() * 0xffff_ffff),
        add_original_image: true,
      } : {}),
      ...(settings.referenceMode === "vibe" && references.length ? {
        reference_image_multiple: references,
        reference_strength_multiple: references.map(() => settings.referenceStrength),
        reference_information_extracted_multiple: references.map(() => settings.referenceInformationExtracted),
        normalize_reference_strength_multiple: true,
      } : {}),
      ...(preciseType && references.length ? {
        director_reference_images: references,
        director_reference_descriptions: references.map(() => ({
          caption: { base_caption: preciseType, char_captions: [] },
          legacy_uc: false,
        })),
        director_reference_strengths: references.map(() => settings.referenceStrength),
        director_reference_secondary_strengths: references.map(() => settings.referenceFidelity),
        director_reference_information_extracted: references.map(() => settings.referenceInformationExtracted),
      } : {}),
    },
  };

  logEvent("novelai", "generate:start", {
    requestId: options.requestId,
    model,
    translator: "grok",
    translatorModel: translated.model,
    width,
    height,
  });
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

    const b64 = await readNovelAiImage(response);
    if (!b64) throw novelAiError("NovelAI returned no image", 502, "NOVELAI_EMPTY_IMAGE");
    const mime = detectImageMimeFromB64(b64);
    if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      throw novelAiError("NovelAI returned invalid image bytes", 502, "NOVELAI_IMAGE_INVALID");
    }
    logEvent("novelai", "generate:done", { requestId: options.requestId, model, width, height });
    return { b64, revisedPrompt: translatedPrompt, usage: null, webSearchCalls: 0, mime, effectiveModel: model };
  } catch (cause) {
    if ((cause as { code?: string }).code?.startsWith("NOVELAI_")) throw cause;
    if ((cause as { name?: string }).name === "AbortError" || (cause as { name?: string }).name === "TimeoutError") {
      throw novelAiError("NovelAI generation timed out or was canceled", 504, "NOVELAI_TIMEOUT");
    }
    throw novelAiError(`NovelAI request failed: ${(cause as Error).message}`, 502, "NOVELAI_NETWORK_FAILED");
  }
}
