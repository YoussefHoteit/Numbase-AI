import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: { "/api/chat": ["./assets/fonts/*"] },
  turbopack: {
    root: process.cwd(),
  },
};

export default withWorkflow(nextConfig);
