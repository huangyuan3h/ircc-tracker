import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

if (process.env.NODE_ENV !== "production") {
  initOpenNextCloudflareForDev();
}

export default nextConfig;