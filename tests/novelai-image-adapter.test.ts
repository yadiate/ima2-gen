import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal(translationBody.messages[1].content, "파란 머리 소녀가 정면을 본다");
    assert.equal(captured[1].url, "https://image.novelai.net/ai/generate-image");
    assert.equal((captured[1].init?.headers as Record<string, string>).Authorization, "Bearer persistent-token");
    assert.equal((captured[1].init?.headers as Record<string, string>).Accept, "application/json");
    const body = JSON.parse(String(captured[1].init?.body));
    assert.equal(body.model, "nai-diffusion-4-5-full");
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
