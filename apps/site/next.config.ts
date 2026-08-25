import type { NextConfig } from 'next';

// Static website for alicebtc.com. Exported as flat HTML so it can be
// hosted anywhere (Vercel/Cloudflare Pages) with no server runtime. It shares
// no code with the wallet app — no react-native/expo shims are needed here.
const nextConfig: NextConfig = {
  output: 'export',
  // Nested `foo/index.html` exports resolve cleanly on static hosts and keep
  // canonical URLs trailing-slashed, matching apps/app-web.
  trailingSlash: true,
  // `next/image` optimization needs a server; static export has none.
  images: { unoptimized: true },
};

export default nextConfig;
