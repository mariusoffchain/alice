// The released Alice version, served at GET /app-version. All four surfaces
// carry one shared number (CHANGELOG.md) and the Worker deploys with every
// release, which makes this constant the single source the update banners
// poll. Bump it as part of the release checklist, with the CHANGELOG entry.
export const APP_RELEASE_VERSION = '0.2.0';
