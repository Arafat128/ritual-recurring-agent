/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rra/core"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
  },
  webpack: (config) => {
    // Optional peer deps from Coinbase/wagmi that we never use
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/evm": false,
      "@x402/evm/upto/client": false,
      "@x402/evm/exact/client": false,
      "@x402/svm/exact/client": false,
      "@x402/core/client": false,
    };
    return config;
  },
};

export default nextConfig;
