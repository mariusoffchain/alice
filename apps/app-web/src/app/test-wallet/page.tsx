'use client';

// The Test Wallet became the Playground. The app ships as a static export,
// so old links land here and are forwarded client-side.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/playground');
  }, [router]);
  return null;
}
