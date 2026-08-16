'use client';

import { useEffect, useRef, useState } from 'react';

// A minimal shape for the native BarcodeDetector, which is not in the TS DOM
// lib. We use only QR decoding; everything else is left untyped on purpose.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

/** Whether this browser can decode QR codes natively (camera and file import). */
export function qrDecodingSupported(): boolean {
  return getDetectorCtor() !== null;
}

/** Decode the first QR code in an image file, or null if none is found. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const Ctor = getDetectorCtor();
  if (!Ctor) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const detector = new Ctor({ formats: ['qr_code'] });
    const codes = await detector.detect(bitmap);
    return codes[0]?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}

/**
 * A camera QR scanner in a modal. Streams the environment-facing camera and
 * polls the native BarcodeDetector; on the first QR it calls onResult with the
 * raw payload. Cleans up the media stream on close. If decoding is unsupported,
 * it says so rather than opening a dead camera.
 */
export function ExplorerQrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const supported = qrDecodingSupported();

  useEffect(() => {
    if (!supported) { setError('This browser cannot scan QR codes. Import a file or paste instead.'); return; }
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = getDetectorCtor()!;
    const detector = new Ctor({ formats: ['qr_code'] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        if (!stopped) setError('Camera access was denied or is unavailable.');
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const tick = async () => {
        if (stopped || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) { onResult(codes[0].rawValue); return; }
        } catch {
          /* transient decode failure between frames; keep polling */
        }
        raf = window.setTimeout(tick, 250);
      };
      tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [supported, onResult]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 60 }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-3 px-4 py-4"
        style={{ maxWidth: 420, width: '100%', backgroundColor: 'var(--alice-bg)', border: '2px solid var(--alice-primary)', borderRadius: 2 }}
        onClick={e => e.stopPropagation()}
      >
        <span className="font-pixel tracking-widest" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>SCAN A QR CODE</span>
        {error ? (
          <p className="font-numbers m-0" style={{ fontSize: 13, color: '#e06060' }}>{error}</p>
        ) : (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 2, backgroundColor: '#000' }}>
            <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: '18%', border: '2px solid var(--alice-primary)', borderRadius: 4, opacity: 0.8 }} />
          </div>
        )}
        <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
          Point the camera at an xpub, descriptor or address QR. Nothing leaves this device.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-pixel tracking-widest self-start cursor-pointer"
          style={{ fontSize: 7, padding: '8px 16px', borderRadius: 2, border: '2px solid var(--alice-border)', backgroundColor: 'transparent', color: 'var(--alice-primary)' }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
