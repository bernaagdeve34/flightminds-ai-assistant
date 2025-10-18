import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // ✅ Build sırasında tip hatalarını yok say
    ignoreBuildErrors: true,
  },
  eslint: {
    // ✅ Lint hatalarını da yok say
    ignoreDuringBuilds: true,
  },
 // output: "export", // (isteğe bağlı, GitHub Pages veya statik export için)
};

export default nextConfig;
