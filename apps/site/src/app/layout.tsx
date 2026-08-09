import type { Metadata, Viewport } from 'next';
import { SITE_IS_PUBLIC, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';
import { StickyAsk } from '@/components/StickyAsk';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Alice: a private AI companion for Bitcoin',
    template: '%s · Alice',
  },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  keywords: [
    'private AI',
    'Bitcoin companion',
    'self-custody',
    'Bitcoin wallet',
    'privacy',
    'Arkade',
    'end-to-end encrypted AI',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'Alice: a private AI companion for Bitcoin',
    description: SITE_TAGLINE,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alice: a private AI companion for Bitcoin',
    description: SITE_TAGLINE,
  },
  robots: SITE_IS_PUBLIC
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d1117',
};

// Organization + WebSite structured data, sitewide. Helps search engines and
// AI answer engines attribute content to Alice and understand the brand.
const orgSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_TAGLINE,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      publisher: { '@id': `${SITE_URL}/#org` },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        {children}
        <StickyAsk />
      </body>
    </html>
  );
}
