import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Fully static site: no server is needed, so it can be hosted anywhere and installed on an iPhone.
  output: "export",
  images: { unoptimized: true },
  // Set when hosted under a sub-path, e.g. GitHub Pages project sites (/MediTrack).
  basePath,
};

export default nextConfig;
