import type { MetadataRoute } from 'next';
import { SITE_IS_PUBLIC, SITE_URL } from '@/lib/site';

// Required for `output: export`, emit a static robots.txt at build time.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  if (!SITE_IS_PUBLIC) {
    // Unlisted preview: keep crawlers out entirely rather than relying on the
    // URL being hard to guess.
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
