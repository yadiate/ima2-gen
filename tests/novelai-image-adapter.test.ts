import assert from "node:assert/strict";
import test from "node:test";
import { generateViaNovelAi } from "../lib/novelAiImageAdapter.js";
import { requireRuntimeContext } from "../lib/runtimeContext.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

test("NovelAI adapter sends a Persistent API Token and parses JSON image output", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ images: [{ image: PNG_1X1, index: 0, seed: 42 }] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ctx = requireRuntimeContext({ novelAiApiKey: "persistent-token" });
    const result = await generateViaNovelAi("1girl, blue hair", ctx, {
      size: "1000x750",
      requestId: "req-nai",
    });
    assert.equal(captured.url, "https://image.novelai.net/ai/generate-image");
    assert.equal((captured.init?.headers as Record<string, string>).Authorization, "Bearer persistent-token");
    assert.equal((captured.init?.headers as Record<string, string>).Accept, "application/json");
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.model, "nai-diffusion-4-5-full");
    assert.equal(body.parameters.width, 1024);
    assert.equal(body.parameters.height, 768);
    assert.equal(body.parameters.v4_prompt.caption.base_caption, "1girl, blue hair");
    assert.equal(result.b64, PNG_1X1);
    assert.equal(result.mime, "image/png");
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
