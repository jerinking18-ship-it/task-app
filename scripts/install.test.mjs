import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports });
  return exports;
}
const { installPlatform, showInstallPrompt } = load("../src/lib/install/platform.ts");
const manifest = load("../src/app/manifest.ts").default();

test("Home Screen launch remains in standalone scope and uses protected account entry", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/account");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(!manifest.start_url.includes("?"));
});
test("all declared icons are real square PNGs at the required sizes", () => {
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png", sizes: "180x180" }]) {
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    const size = Number(icon.sizes.split("x")[0]);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.ok([2, 6].includes(bytes[25]));
  }
});
test("installation guidance distinguishes iPhone, desktop-mode iPad, Android and desktop", () => {
  assert.equal(installPlatform("Mozilla iPhone Safari", "iPhone", 5), "ios");
  assert.equal(installPlatform("Mozilla Macintosh Safari", "MacIntel", 5), "ios");
  assert.equal(installPlatform("Mozilla Android Chrome", "Linux", 5), "android");
  assert.equal(installPlatform("Mozilla Macintosh Safari", "MacIntel", 0), "other");
});
test("native install prompt preserves acceptance and dismissal and safely handles unavailable prompts", async () => {
  for (const outcome of ["accepted", "dismissed"]) {
    let calls = 0;
    assert.equal(await showInstallPrompt({ async prompt() { calls++; }, userChoice: Promise.resolve({ outcome }) }), outcome);
    assert.equal(calls, 1);
  }
  assert.equal(await showInstallPrompt({ async prompt() { throw new Error("expired prompt"); } }), "unavailable");
});
