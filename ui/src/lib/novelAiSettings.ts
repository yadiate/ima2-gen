import type { NovelAiGenerationOptions } from "../types";

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

export function normalizeNovelAiOptions(value: unknown): NovelAiGenerationOptions {
  if (!value || typeof value !== "object") return DEFAULT_NOVELAI_OPTIONS;
  const raw = value as Partial<NovelAiGenerationOptions>;
  return {
    ...DEFAULT_NOVELAI_OPTIONS,
    ...raw,
    seed: typeof raw.seed === "number" && Number.isFinite(raw.seed) ? raw.seed : null,
    characters: Array.isArray(raw.characters)
      ? raw.characters.slice(0, 6).map((character) => ({
        prompt: typeof character?.prompt === "string" ? character.prompt : "",
        negativePrompt: typeof character?.negativePrompt === "string" ? character.negativePrompt : "",
        position: character?.position === "left" || character?.position === "right" ? character.position : "center",
      }))
      : [],
  };
}
