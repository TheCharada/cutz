import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageValidationError, maxImageBytes, prepareCatalogImage,
} from "./image-processing";

async function image(format: "jpeg" | "png" | "webp", width = 2200, height = 1600) {
  return sharp({ create: { width, height, channels: 3, background: "tomato" } })
    .toFormat(format).toBuffer();
}

describe("catalog image processing", () => {
  it.each(["jpeg", "png", "webp"] as const)("converts %s into bounded WebP", async (format) => {
    const bytes = await prepareCatalogImage(await image(format));
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(1024);
    expect(metadata.height).toBeLessThanOrEqual(1024);
    expect(metadata.exif).toBeUndefined();
  });

  it("refuses oversized input", async () => {
    await expect(prepareCatalogImage(Buffer.alloc(maxImageBytes + 1)))
      .rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses unsupported SVG and invalid bytes", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await expect(prepareCatalogImage(svg)).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    await expect(prepareCatalogImage(Buffer.from("not an image")))
      .rejects.toBeInstanceOf(ImageValidationError);
  });

  it("rejects excessive pixel dimensions", async () => {
    const huge = await image("png", 5000, 3000);
    await expect(prepareCatalogImage(huge)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });
});
