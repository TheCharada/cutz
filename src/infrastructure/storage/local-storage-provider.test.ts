import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local-storage-provider";

const folders: string[] = [];
async function storage() {
  const dir = await mkdtemp(join(tmpdir(), "cutz-media-"));
  folders.push(dir);
  return { dir, provider: new LocalStorageProvider(dir) };
}
const key = "services/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp";

afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local catalog image storage", () => {
  it("persists and reads a WebP file outside the application bundle", async () => {
    const { dir, provider } = await storage();
    const content = Buffer.from("media");
    await expect(provider.put(key, content, "image/webp")).resolves.toEqual({
      key, size: content.length, contentType: "image/webp",
    });
    expect(await provider.get(key)).toEqual(content);
    expect(await readFile(join(dir, key))).toEqual(content);
    await provider.delete(key);
    await provider.delete(key);
    expect(await provider.get(key)).toBeNull();
  });

  it.each([
    "../secret.webp",
    "/etc/passwd",
    "services/../../secret.webp",
    "services/one/two.webp",
    "other/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp",
    "services/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp/../other",
  ])("rejects invalid file keys: %s", async (invalid) => {
    const { provider } = await storage();
    await expect(provider.get(invalid)).rejects.toThrow("Invalid media storage key");
    await expect(provider.put(invalid, Buffer.from("x"), "image/webp")).rejects.toThrow();
    await expect(provider.delete(invalid)).rejects.toThrow();
  });
});
