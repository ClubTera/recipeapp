import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // OGP画像は任意の外部ドメインから来るため、リモートパターンを広く許可する。
    // （最適化を通すことで、外部サイトの巨大画像をそのまま配信しないようにする）
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
