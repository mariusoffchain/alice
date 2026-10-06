/** sRGB contrast helpers. Alpha is composited before measuring contrast. */
export function mixColor(foreground: string, background: string, alpha: number) {
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(foreground.slice(i, i + 2), 16) * alpha + parseInt(background.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}
export function opaqueColor(color: string, background: string) {
  if (/^#[\da-f]{8}$/i.test(color)) return mixColor(color.slice(0, 7), background, parseInt(color.slice(7), 16) / 255);
  const rgba = color.match(/^rgba\(([^)]+)\)$/);
  if (!rgba) return color;
  const [r, g, b, alpha] = rgba[1].split(',').map(Number);
  return mixColor('#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join(''), background, alpha);
}
export function luminance(hex: string) {
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c+.055)/1.055) ** 2.4);
  return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function readableColor(color: string, backgrounds: string[], dark: boolean, minimum = 4.8) {
  for (let step = 0; step <= 100; step++) {
    const result = mixColor(dark ? '#ffffff' : '#000000', color, step/100);
    if (backgrounds.every(bg => contrastRatio(result,bg) >= minimum)) return result;
  }
  return dark ? '#ffffff' : '#000000';
}
export function onColor(background: string) {
  return contrastRatio(background,'#ffffff') > contrastRatio(background,'#111111') ? '#ffffff' : '#111111';
}
