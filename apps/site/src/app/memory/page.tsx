import type { Metadata } from 'next';
import { MemoryPage } from '@/components/MemoryPage';

export const metadata: Metadata = {
  title: 'Memory',
  description:
    'What Alice remembers about you, how a fact is captured and filtered, where it is stored (on your device only, never on a server), how it shapes an answer, and how to see and erase all of it.',
  alternates: { canonical: '/memory/' },
};

export default function MemoryRoute() {
  return <MemoryPage />;
}
