import type { NextConfig } from 'next';
const config: NextConfig = { transpilePackages: ['three'], turbopack: { root: process.cwd() } };
export default config;
