// Pixel glyphs from the approved Atelier prototype. Keep this set shared across the web UI.
export const MENU_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 4h16v2H2zm0 5h16v2H2zm0 5h11v2H2z"/></svg>`;
export const CHAT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M3 2h14v2h2v10h-2v2H9v2H5v-2H3v-2H1V4h2zm0 2v10h4v2l2-2h8V4zM5 7h10v2H5zm0 4h6v2H5z"/></svg>`;
export const EXPLORE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h8v2h3v3h2v8h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3zm0 2v2H4v2H3v6h1v2h2v2h8v-2h2v-2h1V7h-1V5h-2V3zm6 3h3l-3 6-7 3 3-7zm-2 3-2 3 3-1 1-3z"/></svg>`;
export const LEARN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 3h7l2 2 2-2h7v13h-7l-2 2-2-2H1zm2 2v9h5l1 1V6L7 5zm8 1v9l1-1h5V5h-4z"/></svg>`;
export const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4h12v2h2v10h-4v-2H6v2H2V6h2zm0 2v8h1v-2h10v2h1V6zm2 1h2v2h2v2H8v2H6v-2H4V9h2zm6 1h2v2h-2zm2 3h2v2h-2z"/></svg>`;
export const PLUS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M9 2h2v7h7v2h-7v7H9v-7H2V9h7z"/></svg>`;
export const HISTORY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 2h8v2h3v3h2v7h-2v3h-3v2H6v-2H3v-3h2v2h2v1h6v-1h2v-2h2V8h-2V5h-2V4H7v1H5v2h3v2H1V2h2v3h1V4h2zm3 4h2v5h3v2H9z"/></svg>`;
export const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 4h3V2h2v2h11v2H7v2H5V6H2zm0 5h10V7h2v2h4v2h-4v2h-2v-2H2zm0 5h5v-2h2v2h9v2H9v2H7v-2H2z"/></svg>`;
export const UP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M9 3h2v2h2v2h2v2h2v2h-3V9h-3v9H9V9H6v2H3V9h2V7h2V5h2z"/></svg>`;

// Settings use the same 20px grid and full-opacity ink as the navigation.
const settingsGlyph = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path fill-rule="evenodd" d="${path}"/></svg>`;
export const PALETTE_ICON = settingsGlyph('M2 2h7v7H2zm2 2v3h3V4zm7-2h7v7h-7zm2 2v3h3V4zM2 11h7v7H2zm2 2v3h3v-3zm7-2h7v7h-7zm2 2v3h3v-3z');
export const MODEL_ICON = settingsGlyph('M5 5h10v10H5zm2 2v6h6V7zM6 1h2v3H6zm6 0h2v3h-2zM6 16h2v3H6zm6 0h2v3h-2zM1 6h3v2H1zm0 6h3v2H1zM16 6h3v2h-3zm0 6h3v2h-3z');
export const ACCOUNT_ICON = settingsGlyph('M6 2h8v8H6zm2 2v4h4V4zM4 12h12v2h2v4H2v-4h2zm0 2v2h12v-2z');
export const DATA_ICON = settingsGlyph('M2 2h16v6H2zm2 2v2h12V4zM2 9h2v2h12V9h2v4H2zm0 5h2v2h12v-2h2v4H2z');

// Chat controls share the same integer grid as the Atelier navigation.
export const COPY_ICON = settingsGlyph('M6 2h12v12H6zm2 2v8h8V4zM2 6h2v10h10v2H2z');
export const CHECK_ICON = settingsGlyph('M2 9h2v2h2v2h2v-2h2V9h2V7h2V5h2V3h2v4h-2v2h-2v2h-2v2h-2v2H8v2H6v-2H4v-2H2z');
export const EDIT_ICON = settingsGlyph('M12 2h4v2h2v4h-2v2h-2v2h-2v2h-2v2H4v-6h2V8h2V6h2V4h2zm0 4v2h2V6zm-2 2v2h2V8zm-2 2v2h2v-2zm-2 2v2h2v-2zM2 18h16v2H2z');
export const DELETE_ICON = settingsGlyph('M7 1h6v2h5v2H2V3h5zM4 6h2v10h8V6h2v12H4zm4 1h2v7H8zm3 0h2v7h-2z');
export const CHEVRON_LEFT_ICON = settingsGlyph('M11 3h3v2h-2v2h-2v2H8v2h2v2h2v2h2v2h-3v-2H9v-2H7v-2H5V9h2V7h2V5h2z');
export const CHEVRON_RIGHT_ICON = settingsGlyph('M6 3h3v2h2v2h2v2h2v2h-2v2h-2v2H9v2H6v-2h2v-2h2v-2h2V9h-2V7H8V5H6z');
export const CHEVRON_DOWN_ICON = settingsGlyph('M3 6h2v2h2v2h2v2h2v-2h2V8h2V6h2v3h-2v2h-2v2h-2v2H9v-2H7v-2H5V9H3z');

export const CLOSE_ICON = settingsGlyph('M3 3h2v2h2v2h2v2h2V7h2V5h2V3h2v2h-2v2h-2v2h-2v2h2v2h2v2h2v2h-2v-2h-2v-2h-2v-2H9v2H7v2H5v2H3v-2h2v-2h2v-2h2V9H7V7H5V5H3z');
export const ATTACHMENT_ICON = settingsGlyph('M8 1h8v1H8zM7 2h10v1H7zM7 3h2v10H7zM11 5h2v8H11zM7 13h6v1H7zM8 14h4v1H8zM15 3h2v14H15zM3 5h2v12H3zM3 17h14v1H3zM4 18h12v1H4z');
export const EYE_OPEN_ICON = settingsGlyph('M6 4h8v2h3v2h2v4h-2v2h-3v2H6v-2H3v-2H1V8h2V6h3zm0 2v2H4v4h2v2h8v-2h2V8h-2V6zM8 8h4v4H8z');
export const EYE_CLOSED_ICON = settingsGlyph('M1 7h2v2h2v2h3v2h4v-2h3V9h2V7h2v4h-2v2h-2v2h-3v3H8v-3H5v-2H3v-2H1zM2 14h2v3H2zm14 0h2v3h-2z');

// Additional glyphs approved in the page atlas; keep currentColor at the call site.
export const SEARCH_ICON = settingsGlyph('M4 2h8v2h2v8h-2v2H4v-2H2V4h2zm0 2v8h8V4zm9 9h2v2h2v2h2v2h-3v-2h-2v-2h-1z');
export const NEXT_ICON = settingsGlyph('M11 3h2v2h2v2h2v2h2v2h-2v2h-2v2h-2v2h-2v-3h2v-3H1V9h12V6h-2z');
export const BACK_ICON = settingsGlyph('M7 3h2v3H7v3h12v2H7v3h2v3H7v-2H5v-2H3v-2H1V9h2V7h2V5h2z');
export const EXTERNAL_ICON = settingsGlyph('M10 2h8v8h-2V6h-2v2h-2v2h-2v2H8v2H6v-2h2v-2h2V8h2V6h2V4h-4zM2 5h5v2H4v9h9v-3h2v5H2z');
export const LINK_ICON = settingsGlyph('M2 7h7v2H4v6h5v2H2zm9-4h7v10h-7v-2h5V5h-5zM6 9h8v2H6z');
export const MAIL_ICON = settingsGlyph('M1 4h18v2H1zM1 6h4v2H1zM15 6h4v2H15zM5 8h2v2H5zM13 8h2v2H13zM7 10h6v2H7zM1 8h2v6H1zM17 8h2v6H17zM1 14h18v2H1z');
export const KEY_ICON = settingsGlyph('M6 2h8v1H6zM5 3h10v1H5zM5 4h2v4H5zM13 4h2v4H13zM5 8h10v1H5zM6 9h8v1H6zM9 10h2v2H9zM9 12h6v2H9zM9 14h2v2H9zM9 16h6v2H9z');
export const WALLET_ICON = settingsGlyph('M2 3h14v3h2v11H2zm2 2v1h10V5zm0 3v7h12V8zm8 2h2v3h-2z');
export const DOWNLOAD_ICON = settingsGlyph('M9 2h2v6H9zM5 8h10v2H5zM7 10h6v2H7zM9 12h2v2H9zM3 14h2v2H3zM15 14h2v2H15zM3 16h14v2H3z');
export const REFRESH_ICON = settingsGlyph('M6 2h8v2h2v2h2V2h2v8h-8V8h4V6h-2V4H6v2H4v8h2v2h8v-2h2v-2h2v4h-2v2H4v-2H2V4h4z');
export const QR_ICON = settingsGlyph('M1 1h6v2H3v4H1zm12 0h6v6h-2V3h-4zM1 13h2v4h4v2H1zm16 0h2v6h-6v-2h4zM5 5h4v4H5zm6 0h4v4h-4zM5 11h4v4H5zm6 0h2v2h2v2h-4z');
export const INFO_ICON = settingsGlyph('M4 2h12v2h2v12h-2v2H4v-2H2V4h2zm0 2v12h12V4zm5 2h2v2H9zm0 4h2v4H9z');
export const HELP_ICON = settingsGlyph('M5 2h10v2h2v6h-2v2h-4v2H9v-4h6V4H5v3H3V4h2zm4 14h2v2H9z');
export const CLOCK_ICON = settingsGlyph('M4 2h12v2h2v12h-2v2H4v-2H2V4h2zm0 2v12h12V4zm5 2h2v5h3v2H9z');
export const NETWORK_ICON = settingsGlyph('M7 1h6v6H7zm2 2v2h2V3zM9 8h2v2h6v3h-2v-1H5v1H3v-3h6zM1 14h6v5H1zm2 2v1h2v-1zm10-2h6v5h-6zm2 2v1h2v-1z');
export const CHART_ICON = settingsGlyph('M2 2h2v14h14v2H2zm4 9h2v3H6zm4-4h2v7h-2zm4-4h2v11h-2z');
export const RECEIVE_ICON = settingsGlyph('M9 2h2v9h3V9h3v2h-2v2h-2v2h-2v2H9v-2H7v-2H5v-2H3V9h3v2h3z');

// GitHub mark from Primer Octicons (MIT), preserved rather than pixel-redrawn.
// Source: https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg
export const GITHUB_ICON = `<svg fill="{{COLOR}}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>`;
export const GLOBE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path fill-rule="evenodd" d="M6 1h8v2h3v3h2v8h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3zm0 2v2H5v1H3v8h2v1h1v2h8v-2h1v-1h2V6h-2V5h-1V3z"/><path d="M2 9h16v2H2zM7 3h2v4H7zM6 7h2v6H6zM7 13h2v4H7zM11 3h2v4h-2zM12 7h2v6h-2zM11 13h2v4h-2z"/></svg>`;
