/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: { '/api/contract': ['./public/download/contracts/**/*'] },
  reactStrictMode: false,
};

module.exports = nextConfig;
