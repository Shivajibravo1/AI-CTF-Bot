/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Long-running vision/reason calls stream; keep server actions body limit generous for screenshots.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
