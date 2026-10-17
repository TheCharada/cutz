import type { NextConfig } from "next";

const capabilityHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return ["/a/:path*", "/w/:path*", "/o/:path*"].map((source) => ({
      source,
      headers: capabilityHeaders,
    }));
  },
};

export default nextConfig;
