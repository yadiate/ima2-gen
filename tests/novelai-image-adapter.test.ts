import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { generateViaNovelAi } from "../lib/novelAiImageAdapter.js";
import { requireRuntimeContext } from "../lib/runtimeContext.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

test("NovelAI adapter sends a Persistent API Token and parses JSON image output", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    if (String(url).endsWith("/v1/chat/completions")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "1girl, blue hair, looking at viewer" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ images: [{ image: PNG_1X1, index: 0, seed: 42 }] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ctx = requireRuntimeContext({ novelAiApiKey: "persistent-token" });
    const result = await generateViaNovelAi("파란 머리 소녀가 정면을 본다", ctx, {
      size: "1000x750",
      requestId: "req-nai",
    });
    assert.equal(captured.length, 2);
    assert.match(captured[0].url, /\/v1\/chat\/completions$/);
    const translationBody = JSON.parse(String(captured[0].init?.body));
    assert.equal(JSON.parse(translationBody.messages[1].content).prompt, "파란 머리 소녀가 정면을 본다");
    assert.equal(captured[1].url, "https://image.novelai.net/ai/generate-image");
    assert.equal((captured[1].init?.headers as Record<string, string>).Authorization, "Bearer persistent-token");
    assert.equal((captured[1].init?.headers as Record<string, string>).Accept, "application/json");
    const body = JSON.parse(String(captured[1].init?.body));
    assert.equal(body.model, "nai-diffusion-5-full");
    assert.equal(body.parameters.params_version, 4);
    assert.equal(body.parameters.width, 1024);
    assert.equal(body.parameters.height, 768);
    assert.equal(body.input, "1girl, blue hair, looking at viewer");
    assert.equal(body.parameters.v4_prompt.caption.base_caption, "1girl, blue hair, looking at viewer");
    assert.equal(result.b64, PNG_1X1);
    assert.equal(result.mime, "image/png");
    assert.equal(result.revisedPrompt, "1girl, blue hair, looking at viewer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NovelAI adapter fails before network access when no token is configured", async () => {
  const ctx = requireRuntimeContext({ novelAiApiKey: undefined });
  await assert.rejects(
    () => generateViaNovelAi("test", ctx),
    (error: Error & { code?: string }) => error.code === "NOVELAI_API_KEY_MISSING",
  );
});

test("NovelAI adapter does not send a generation request when Grok translation fails", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({ error: { message: "translation rejected" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ctx = requireRuntimeContext({ novelAiApiKey: "persistent-token" });
    await assert.rejects(
      () => generateViaNovelAi("테스트", ctx),
      (error: Error & { code?: string }) => error.code === "NOVELAI_GROK_TRANSLATION_FAILED",
    );
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /\/v1\/chat\/completions$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NovelAI adapter forwards negative, character, sampling, and reference options", async () => {
  const originalFetch = globalThis.fetch;
  let novelAiBody: any;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/v1/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        prompt: "2girls, night city",
        negativePrompt: "rain",
        characters: [{ prompt: "girl, red hair", negativePrompt: "hat" }],
      }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    novelAiBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ images: [{ image: PNG_1X1 }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ctx = requireRuntimeContext({ novelAiApiKey: "persistent-token" });
    await generateViaNovelAi("밤 도시의 두 소녀", ctx, {
      model: "nai-diffusion-4-5-full",
      references: [{ b64: "reference-b64" }],
      novelAiOptions: {
        negativePrompt: "비",
        ucPreset: "light",
        sampler: "k_dpmpp_2m",
        noiseSchedule: "exponential",
        steps: 36,
        scale: 6.2,
        cfgRescale: 0.25,
        seed: 1234,
        qualityTags: false,
        smea: "dynamic",
        decrisper: true,
        characters: [{ prompt: "빨간 머리 소녀", negativePrompt: "모자", position: "left" }],
        referenceMode: "vibe",
        referenceStrength: 0.7,
        referenceInformationExtracted: 0.8,
        referenceFidelity: 0.5,
        img2imgStrength: 0.7,
        img2imgNoise: 0,
      },
    });
    assert.equal(novelAiBody.parameters.negative_prompt.includes("rain"), true);
    assert.equal(novelAiBody.parameters.steps, 36);
    assert.equal(novelAiBody.parameters.scale, 6.2);
    assert.equal(novelAiBody.parameters.seed, 1234);
    assert.equal(novelAiBody.parameters.sampler, "k_dpmpp_2m");
    assert.equal(novelAiBody.parameters.sm_dyn, true);
    assert.equal(novelAiBody.parameters.dynamic_thresholding, true);
    assert.equal(novelAiBody.parameters.v4_prompt.caption.char_captions[0].char_caption, "girl, red hair");
    assert.deepEqual(novelAiBody.parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.2, y: 0.5 }]);
    assert.deepEqual(novelAiBody.parameters.reference_image_multiple, ["reference-b64"]);
    assert.deepEqual(novelAiBody.parameters.reference_strength_multiple, [0.7]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NovelAI adapter extracts the image from a ZIP response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "1girl" } }] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const archive = zipSync({ "image_0.png": Buffer.from(PNG_1X1, "base64") });
    return new Response(Buffer.from(archive), { headers: { "Content-Type": "application/zip" } });
  };
  try {
    const ctx = requireRuntimeContext({ novelAiApiKey: "persistent-token" });
    const result = await generateViaNovelAi("소녀", ctx);
    assert.equal(result.b64, PNG_1X1);
    assert.equal(result.mime, "image/png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
