import type { Metadata, Viewport } from 'next';
import { ChatProviderWrapper } from '@/lib/chat-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alice - Your Bitcoin Companion',
  description:
    'Alice is a Bitcoin education AI companion that helps you learn about Bitcoin, privacy, and self-sovereignty in a friendly, accessible way.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
    shortcut: '/favicon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d1117',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[var(--alice-bg)]">
        <ChatProviderWrapper>{children}</ChatProviderWrapper>
      </body>
    </html>
  );
}
