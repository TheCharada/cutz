import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("capability page headers", () => {
  it("disables caching and referrer propagation for every capability page", async () => {
    const rules = await nextConfig.headers?.();

    expect(rules).toEqual(
      ["/a/:path*", "/w/:path*", "/o/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      })),
    );
  });
});
