/**
 * Next.js Configuration for Clapboard
 *
 * IMPORTANT: Next.js is used ONLY as a Turbopack build pipeline for the Chrome extension.
 * This is NOT a Next.js web application — there are no pages/, app/, or API routes.
 *
 * The build output is processed by scripts/build.ts to produce a valid Chrome extension
 * in the dist/ directory.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use Turbopack for fast builds
  experimental: {
    turbo: {},
  },

  // Disable server-side features — this is a client-only extension
  output: "export",

  // Don't create a Next.js app structure
  distDir: ".next",

  // Disable image optimization (not applicable for extension)
  images: {
    unoptimized: true,
  },

  // TypeScript strict mode is handled in tsconfig.json
  typescript: {
    ignoreBuildErrors: false,
  },

  // ESLint runs separately
  eslint: {
    ignoreDuringBuilds: false,
  },

  // Webpack config for extension-specific needs
  webpack: (config, { isServer }) => {
    // Don't bundle on server (we're client-only)
    if (isServer) {
      return config;
    }

    // Chrome extension specific adjustments
    config.output.globalObject = "globalThis";

    return config;
  },
};

export default nextConfig;
