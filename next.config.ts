import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      "./data/**/*",
      "./backups/**/*",
      "./test-results/**/*",
      "./output/**/*",
      "./tmp/**/*",
      "./.env*",
      "./.local-access.txt",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
