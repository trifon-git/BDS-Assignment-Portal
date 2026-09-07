import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the Docker image can run without node_modules.
  output: "standalone",

  // better-sqlite3 is a native module and must be require()'d, not bundled.
  serverExternalPackages: ["better-sqlite3"],

  // Server Actions are used for small mutations only; file uploads go through
  // the route handler at /api/submissions/upload, which streams the body and is
  // not subject to this limit. Keep this modest so a stray large POST to an
  // action is rejected early.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // The app sits behind the university's reverse proxy; don't advertise itself.
  poweredByHeader: false,
};

export default nextConfig;
