import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { mountKeyRoutes } from "../routes/keys.ts";

test("NovelAI Persistent API Token saves without an unreliable account probe", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "ima2-novelai-key-"));
  const configFile = join(rootDir, "config.json");
  const ctx = {
    rootDir,
    packageVersion: "test",
    config: {
      ...config,
      storage: { ...config.storage, configFile },
      log: { ...config.log, level: "silent" },
    },
  };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  mountKeyRoutes(app, ctx as never);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const running = app.listen(0, "127.0.0.1", () => resolve(running));
  });
  const address = server.address() as import("node:net").AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/keys/novelai`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "fresh-persistent-token" }),
    });
    assert.equal(response.status, 200);
    const saved = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(saved.novelAiApiKey, "fresh-persistent-token");
    assert.equal((ctx as { novelAiApiKey?: string }).novelAiApiKey, "fresh-persistent-token");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(rootDir, { recursive: true, force: true });
  }
});
