import { resolve } from "node:path";
import { LocalStorageProvider } from "./local-storage-provider";

export { LocalStorageProvider } from "./local-storage-provider";
export { ImageValidationError, maxImageBytes, prepareCatalogImage } from "./image-processing";
export type { StoredFile, StorageProvider } from "./storage-provider";

export function getMediaStorage() {
  return new LocalStorageProvider(
    process.env.MEDIA_STORAGE_ROOT ?? resolve(process.cwd(), ".data/media"),
  );
}
