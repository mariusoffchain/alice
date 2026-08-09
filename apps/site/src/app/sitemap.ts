import type { MetadataRoute } from 'next';
import { SITE_ROUTES, SITE_URL } from '@/lib/site';

// Required for `output: export`, emit a static sitemap.xml at build time.
export const dynamic = 'force-static';

// Emitted as a static sitemap.xml at build time (output: 'export').
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return SITE_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: route === '/' ? 1 : 0.8,
  }));
}
