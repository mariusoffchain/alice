// Hard limits on what the free relay will accept or generate.
//
// These live outside index.ts on purpose. index.ts is the Worker entrypoint,
// and workerd rejects any named export there that is not a function or an
// ExportedHandler — a plain `export const MAX_TOKENS_CEILING = 8192` is
// enough to stop the runtime booting at all, which breaks `wrangler dev`
// even though `wrangler deploy` happens to tolerate it.

/** Hard ceiling on generated tokens, whatever the client asks for. */
export const MAX_TOKENS_CEILING = 8192;

/** Default cap on a single Private Cloud request body. */
export const DEFAULT_FREE_REQUEST_BYTES = 256 * 1024;

/** Most encrypted messages a single chat request may carry. */
export const MAX_FREE_MESSAGES = 64;
