// The shared "ask Alice" mark: the Alice rabbit in negative inside a solid
// pixel speech bubble. Composed at module load from ALICE_ICON_SVG so the
// rabbit stays the single source of truth; the bubble says "talk to me", the
// rabbit says who answers.
//
// Two colour placeholders: {{COLOR}} fills the bubble, {{INK}} draws the
// rabbit on top of it (pick them so they contrast, e.g. primary + on-primary).
import { ALICE_ICON_SVG } from './alice-icon-svg';

// The rabbit artwork spans roughly x 235-512, y 103-632 in its 750 viewBox;
// scaled to 0.95 and translated by (70, 1) it sits centered in the bubble's
// square 600x600 body with even margins. The tail hangs outside that square.
const RABBIT_INNER = ALICE_ICON_SVG
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replaceAll('{{COLOR}}', '{{INK}}');

const BUBBLE_RECTS = [
  // Solid square body; shorter first and last rows keep the corners pixel-rounded.
  '<rect fill="{{COLOR}}" x="175" y="50" width="500" height="50"/>',
  '<rect fill="{{COLOR}}" x="125" y="100" width="600" height="500"/>',
  '<rect fill="{{COLOR}}" x="175" y="600" width="500" height="50"/>',
  // Tail, stepping down bottom-right, outside the square.
  '<rect fill="{{COLOR}}" x="525" y="650" width="150" height="50"/>',
  '<rect fill="{{COLOR}}" x="575" y="700" width="100" height="50"/>',
  '<rect fill="{{COLOR}}" x="625" y="750" width="50" height="50"/>',
].join('');

// shape-rendering="crispEdges" turns antialiasing off for the whole icon: the
// rabbit is exported as many abutting rects, and with AA on, every shared edge
// bleeds a hairline of the bubble colour through.
export const ASK_ALICE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1000" viewBox="0 0 850 850" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" version="1.0">${BUBBLE_RECTS}<g transform="translate(70, 1) scale(0.95)">${RABBIT_INNER}</g></svg>`;
