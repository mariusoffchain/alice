import type { PackDescriptor } from './pack-downloader';

// Packs are published as GitHub Release assets on this same repo (see
// scripts/publish-knowledge-pack.js and knowledge-packs/ for pack sources).
// A release asset is only publicly downloadable while the repo itself is
// public, until then, downloads here will fail for anyone without repo
// access, which is expected during the private-repo phase.
//
// Empty for now by design: the download/verify/update mechanism has been
// built and verified (see pack-downloader.test.ts and the Phase 3/4 notes),
// but real editorial packs come later. Add entries here once a real pack is
// published with scripts/publish-knowledge-pack.js.
export const KNOWLEDGE_PACK_CATALOG: PackDescriptor[] = [];
