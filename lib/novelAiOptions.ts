export const NOVELAI_UC_PRESETS = {
  heavy: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
  light: "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
  human: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
  furry: "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, blurred foreground, chromatic aberration, sketch, simple, outline, multiple scenes",
  none: "",
} as const;

export type NovelAiCharacterPrompt = {
  prompt: string;
  negativePrompt: string;
  position: "left" | "center" | "right";
};

export type NovelAiGenerationOptions = {
  negativePrompt: string;
  ucPreset: keyof typeof NOVELAI_UC_PRESETS;
  sampler: "k_euler" | "k_euler_ancestral" | "k_dpmpp_2s_ancestral" | "k_dpmpp_2m" | "k_dpmpp_sde";
  noiseSchedule: "native" | "karras" | "exponential" | "polyexponential";
  steps: number;
  scale: number;
  cfgRescale: number;
  seed: number | null;
  qualityTags: boolean;
  smea: "off" | "auto" | "smea" | "dynamic";
  decrisper: boolean;
  characters: NovelAiCharacterPrompt[];
  referenceMode: "none" | "img2img" | "vibe" | "precise-character" | "precise-style" | "precise-character-style";
  referenceStrength: number;
  referenceInformationExtracted: number;
  referenceFidelity: number;
  img2imgStrength: number;
  img2imgNoise: number;
};

export const DEFAULT_NOVELAI_OPTIONS: NovelAiGenerationOptions = {
  negativePrompt: "",
  ucPreset: "heavy",
  sampler: "k_euler_ancestral",
  noiseSchedule: "karras",
  steps: 28,
  scale: 5,
  cfgRescale: 0,
  seed: null,
  qualityTags: true,
  smea: "off",
  decrisper: false,
  characters: [],
  referenceMode: "none",
  referenceStrength: 0.6,
  referenceInformationExtracted: 1,
  referenceFidelity: 0.5,
  img2imgStrength: 0.7,
  img2imgNoise: 0,
};

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;

export function normalizeNovelAiOptions(raw: unknown): NovelAiGenerationOptions {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const seed = value.seed === null || value.seed === "" || value.seed === undefined
    ? null
    : Math.trunc(clamp(value.seed, 0, 0, 0xffff_ffff));
  const characters = Array.isArray(value.characters)
    ? value.characters.slice(0, 6).map((entry) => {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return {
        prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 8_000) : "",
        negativePrompt: typeof item.negativePrompt === "string" ? item.negativePrompt.slice(0, 8_000) : "",
        position: oneOf(item.position, ["left", "center", "right"] as const, "center"),
      };
    })
    : [];
  return {
    negativePrompt: typeof value.negativePrompt === "string" ? value.negativePrompt.slice(0, 16_000) : "",
    ucPreset: oneOf(value.ucPreset, ["heavy", "light", "human", "furry", "none"] as const, DEFAULT_NOVELAI_OPTIONS.ucPreset),
    sampler: oneOf(value.sampler, ["k_euler", "k_euler_ancestral", "k_dpmpp_2s_ancestral", "k_dpmpp_2m", "k_dpmpp_sde"] as const, DEFAULT_NOVELAI_OPTIONS.sampler),
    noiseSchedule: oneOf(value.noiseSchedule, ["native", "karras", "exponential", "polyexponential"] as const, DEFAULT_NOVELAI_OPTIONS.noiseSchedule),
    steps: Math.round(clamp(value.steps, DEFAULT_NOVELAI_OPTIONS.steps, 1, 50)),
    scale: clamp(value.scale, DEFAULT_NOVELAI_OPTIONS.scale, 0, 10),
    cfgRescale: clamp(value.cfgRescale, DEFAULT_NOVELAI_OPTIONS.cfgRescale, 0, 1),
    seed,
    qualityTags: value.qualityTags !== false,
    smea: oneOf(value.smea, ["off", "auto", "smea", "dynamic"] as const, DEFAULT_NOVELAI_OPTIONS.smea),
    decrisper: value.decrisper === true,
    characters,
    referenceMode: oneOf(value.referenceMode, ["none", "img2img", "vibe", "precise-character", "precise-style", "precise-character-style"] as const, DEFAULT_NOVELAI_OPTIONS.referenceMode),
    referenceStrength: clamp(value.referenceStrength, DEFAULT_NOVELAI_OPTIONS.referenceStrength, -1, 1),
    referenceInformationExtracted: clamp(value.referenceInformationExtracted, DEFAULT_NOVELAI_OPTIONS.referenceInformationExtracted, 0, 1),
    referenceFidelity: clamp(value.referenceFidelity, DEFAULT_NOVELAI_OPTIONS.referenceFidelity, -1, 1),
    img2imgStrength: clamp(value.img2imgStrength, DEFAULT_NOVELAI_OPTIONS.img2imgStrength, 0.01, 0.99),
    img2imgNoise: clamp(value.img2imgNoise, DEFAULT_NOVELAI_OPTIONS.img2imgNoise, 0, 1),
  };
}

export function combinedNovelAiNegativePrompt(options: NovelAiGenerationOptions, translatedUserNegative: string): string {
  return [NOVELAI_UC_PRESETS[options.ucPreset], translatedUserNegative.trim()].filter(Boolean).join(", ");
}
