import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Avoid Next.js picking an unrelated monorepo root because of lockfiles elsewhere on the machine.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
