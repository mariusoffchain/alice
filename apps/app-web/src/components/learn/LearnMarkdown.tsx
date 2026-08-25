'use client';

import { useEffect, useState } from 'react';
import type { LearnBlock, LearnInline } from '@/lib/learn/markdown';
import { normalizeLinkHref, parseMarkdown, resolveAssetUrl } from '@/lib/learn/markdown';
import { openExternalUrl } from '@/lib/open-external';

type AnchorClick = (anchorId: string) => void;

// Renderer for PlanB course markdown. Media is online-only by decision: the
// 14 GB of images/videos never ship with the app, so offline readers get an
// explicit placeholder instead of a broken image (never a silent failure).

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function InlineNodes({ nodes, assetBase, onAnchorClick }: { nodes: LearnInline[]; assetBase: string; onAnchorClick?: AnchorClick }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'anchor':
            return (
              <button
                key={i}
                onClick={() => onAnchorClick?.(node.anchorId)}
                className="cursor-pointer"
                title="See it in the Explorer"
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  font: 'inherit',
                  color: 'var(--alice-primary)',
                  borderBottom: '2px dotted var(--alice-primary)',
                }}
              >
                {node.text}
                <span aria-hidden="true" style={{ fontSize: '0.75em', marginLeft: 3, verticalAlign: 'middle' }}>▸</span>
              </button>
            );
          case 'bold':
            return <strong key={i}>{node.text}</strong>;
          case 'italic':
            return <em key={i}>{node.text}</em>;
          case 'code':
            return (
              <code
                key={i}
                style={{
                  background: 'var(--alice-bg-soft)',
                  border: '1px solid var(--alice-border)',
                  borderRadius: 2,
                  padding: '1px 4px',
                  fontSize: '0.9em',
                }}
              >
                {node.text}
              </code>
            );
          case 'link': {
            // Always leaves the app in a NEW context: system browser on
            // desktop (Tauri shell), new tab on the web. The href is
            // normalized first (the corpus has protocol-less domains that
            // would otherwise navigate the app itself).
            const href = normalizeLinkHref(node.href, assetBase);
            return (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(href);
                }}
                style={{ color: 'var(--alice-primary)', textDecoration: 'underline' }}
              >
                {node.text}
              </a>
            );
          }
          default:
            return <span key={i}>{node.text}</span>;
        }
      })}
    </>
  );
}

function OfflineMediaCard({ label }: { label: string }) {
  return (
    <div
      style={{
        border: '2px dashed var(--alice-border)',
        borderRadius: 2,
        padding: 16,
        margin: '16px 0',
        color: 'var(--alice-muted)',
        textAlign: 'center',
      }}
    >
      <div className="font-pixel" style={{ fontSize: 8 }}>OFFLINE</div>
      <p style={{ margin: '8px 0 0', fontSize: 14 }}>{label}</p>
    </div>
  );
}

function VideoBlock({
  videoId,
  videos,
  lang,
  online,
}: {
  videoId: string;
  videos: Record<string, Record<string, string>>;
  lang: string;
  online: boolean;
}) {
  // Many courses only carry the fr YouTube id; fall back to whatever exists
  // rather than dropping the video.
  const byLang = videos[videoId] ?? {};
  const youtubeId = byLang[lang] ?? byLang.en ?? byLang.fr ?? Object.values(byLang)[0];
  if (!youtubeId) return null;
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  if (!online) {
    return (
      <div
        style={{
          border: '2px dashed var(--alice-border)',
          borderRadius: 2,
          padding: 16,
          margin: '16px 0',
          color: 'var(--alice-muted)',
        }}
      >
        <div className="font-pixel" style={{ fontSize: 8 }}>VIDEO · OFFLINE</div>
        <p style={{ margin: '8px 0 0', fontSize: 14, wordBreak: 'break-all' }}>
          Open it on a connected device:{' '}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); void openExternalUrl(url); }}
            style={{ color: 'var(--alice-primary)', textDecoration: 'underline' }}
          >
            {url}
          </a>
        </p>
      </div>
    );
  }
  return (
    <div style={{ margin: '16px 0', border: '2px solid var(--alice-border)', borderRadius: 2 }}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
        title="Course video"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', border: 0 }}
      />
    </div>
  );
}

export function LearnMarkdown({
  markdown,
  assetBase,
  videos,
  lang,
  blocks: preparsed,
  onAnchorClick,
}: {
  markdown: string;
  assetBase: string;
  videos: Record<string, Record<string, string>>;
  lang: string;
  /** Caller-prepared blocks (e.g. anchor-annotated); parses `markdown` if absent. */
  blocks?: LearnBlock[];
  onAnchorClick?: AnchorClick;
}) {
  const online = useOnline();
  const blocks = preparsed ?? parseMarkdown(markdown);

  return (
    <div className="font-numbers" style={{ fontSize: 16, lineHeight: '26px', color: 'var(--alice-text)' }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} assetBase={assetBase} videos={videos} lang={lang} online={online} onAnchorClick={onAnchorClick} />
      ))}
    </div>
  );
}

function Block({
  block,
  assetBase,
  videos,
  lang,
  online,
  onAnchorClick,
}: {
  block: LearnBlock;
  assetBase: string;
  videos: Record<string, Record<string, string>>;
  lang: string;
  online: boolean;
  onAnchorClick?: AnchorClick;
}) {
  switch (block.kind) {
    case 'heading': {
      const size = block.level <= 3 ? 12 : 9;
      return (
        <div className="font-pixel" style={{ fontSize: size, margin: '28px 0 12px', lineHeight: 1.6 }}>
          <InlineNodes nodes={block.inline} assetBase={assetBase} onAnchorClick={onAnchorClick} />
        </div>
      );
    }
    case 'paragraph':
      return (
        <p style={{ margin: '12px 0' }}>
          <InlineNodes nodes={block.inline} assetBase={assetBase} onAnchorClick={onAnchorClick} />
        </p>
      );
    case 'code':
      return (
        <pre
          style={{
            background: 'var(--alice-bg-soft)',
            border: '2px solid var(--alice-border)',
            borderRadius: 2,
            padding: 12,
            margin: '16px 0',
            overflowX: 'auto',
            fontSize: 13,
            lineHeight: '20px',
          }}
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote
          style={{
            borderLeft: '4px solid var(--alice-primary)',
            margin: '16px 0',
            padding: '4px 0 4px 14px',
            color: 'var(--alice-muted)',
          }}
        >
          <InlineNodes nodes={block.inline} assetBase={assetBase} onAnchorClick={onAnchorClick} />
        </blockquote>
      );
    case 'list':
      return block.ordered ? (
        <ol style={{ margin: '12px 0', paddingLeft: 24 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ margin: '6px 0' }}>
              <InlineNodes nodes={item} assetBase={assetBase} onAnchorClick={onAnchorClick} />
            </li>
          ))}
        </ol>
      ) : (
        <ul style={{ margin: '12px 0', paddingLeft: 24, listStyleType: 'square' }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ margin: '6px 0' }}>
              <InlineNodes nodes={item} assetBase={assetBase} onAnchorClick={onAnchorClick} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div style={{ overflowX: 'auto', margin: '16px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="font-pixel"
                    style={{ border: '1px solid var(--alice-border)', padding: '8px 10px', fontSize: 8, textAlign: 'left' }}
                  >
                    <InlineNodes nodes={cell} assetBase={assetBase} onAnchorClick={onAnchorClick} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ border: '1px solid var(--alice-border)', padding: '8px 10px' }}>
                      <InlineNodes nodes={cell} assetBase={assetBase} onAnchorClick={onAnchorClick} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      if (!online) return <OfflineMediaCard label="Connect to the internet to see this image." />;
      return (
        // Remote course illustration, dimensions unknown ahead of time.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveAssetUrl(block.src, assetBase)}
          alt={block.alt}
          loading="lazy"
          style={{
            maxWidth: '100%',
            display: 'block',
            margin: '16px auto',
            border: '2px solid var(--alice-border)',
            borderRadius: 2,
            // Corpus illustrations are often transparent webp drawn for a
            // light page; keep them readable on dark palettes.
            background: '#f3efe7',
          }}
        />
      );
    case 'video':
      return <VideoBlock videoId={block.videoId} videos={videos} lang={lang} online={online} />;
    case 'hr':
      return <hr style={{ border: 0, borderTop: '2px solid var(--alice-border)', margin: '24px 0' }} />;
    default:
      return null;
  }
}
