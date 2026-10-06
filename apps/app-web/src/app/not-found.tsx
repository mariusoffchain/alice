import Link from 'next/link';
import { SvgIcon } from '@/components/SvgIcon';
import { BACK_ICON } from '@/lib/atelier-icons';

export default function NotFound() {
  return <main className="font-numbers flex min-h-full flex-col items-start justify-center gap-5 mx-auto px-6" style={{ maxWidth: 640, color: 'var(--alice-text)' }}>
    <span className="font-pixel" style={{ fontSize: 12, color: 'var(--alice-primary)' }}>ALICE · 404</span>
    <h1 className="font-pixel m-0" style={{ fontSize: 18, lineHeight: 1.8, color: 'var(--alice-heading)' }}>PAGE NOT FOUND</h1>
    <p className="m-0" style={{ color: 'var(--alice-muted)', lineHeight: 1.6 }}>This page is unavailable or the link has changed. You can return to Alice to continue.</p>
    <Link href="/" className="alice-control alice-control--primary"><SvgIcon svg={BACK_ICON} size={16} /> Back to Alice</Link>
  </main>;
}
