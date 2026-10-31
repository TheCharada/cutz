import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { StorageProvider, StoredFile } from "./storage-provider";

const mediaKey = /^(services|staff)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private filePath(key: string) {
    if (!mediaKey.test(key) || isAbsolute(key)) {
      throw new Error("Invalid media storage key");
    }
    const file = resolve(this.root, key);
    const relativePath = relative(this.root, file);
    if (relativePath.startsWith(".." + sep) || relativePath === ".." || isAbsolute(relativePath)) {
      throw new Error("Media storage key escapes the configured directory");
    }
    return file;
  }

  async put(key: string, content: Buffer, contentType: string): Promise<StoredFile> {
    const destination = this.filePath(key);
    const directory = resolve(destination, "..");
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${randomUUID()}.upload`);
    try {
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { key, contentType, size: content.length };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
