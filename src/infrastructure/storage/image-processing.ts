import sharp from "sharp";

export const maxImageBytes = 4 * 1024 * 1024;
export const maxImagePixels = 12_000_000;
const formats = new Set(["jpeg", "png", "webp"]);

export class ImageValidationError extends Error {
  constructor(public readonly code: "TOO_LARGE" | "UNSUPPORTED_FORMAT" | "INVALID_IMAGE") {
    super(code);
  }
}

export async function prepareCatalogImage(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > maxImageBytes) throw new ImageValidationError("TOO_LARGE");
  if (bytes.length === 0) throw new ImageValidationError("INVALID_IMAGE");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: maxImagePixels, failOn: "error" }).metadata();
  } catch {
    throw new ImageValidationError("INVALID_IMAGE");
  }
  if (!metadata.format || !formats.has(metadata.format)) {
    throw new ImageValidationError("UNSUPPORTED_FORMAT");
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxImagePixels) {
    throw new ImageValidationError("INVALID_IMAGE");
  }

  try {
    return await sharp(bytes, { limitInputPixels: maxImagePixels, failOn: "error" })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch {
    throw new ImageValidationError("INVALID_IMAGE");
  }
}
