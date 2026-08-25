// Platform dispatch: Next (web/desktop) resolves this file, which forwards to
// the browser implementation; Metro native resolves semantic-runtime.native.ts
// and Metro web resolves semantic-runtime.web.ts.
export * from './semantic-runtime-browser';
