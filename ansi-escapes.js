'use strict'

const palette = [
  /* 8 standard colors; not all terminals use the same RGB values for these
   * The following are RGB values used by xterm */
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  /* 8 high-intensity colors */
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255]
];
/* Add 216 colors for 6x6x6 color 'cube' */
for (var i = 0; i < 216; i++) {
  palette.push([Math.floor(i / 36) * 51, Math.floor((i % 36) / 6) * 51, (i % 6) * 51]);
}
/* Add 24 shades of gray */
for (var i = 0; i < 24; i++) {
  palette.push([i*10 + 8, i*10 + 8, i*10 + 8]);
}

function rgbDistanceSquared(r, g, b, color) {
  return (r-color[0])**2 + (g-color[1])**2 + (b-color[2])**2;
}

function colorEscape8Bit(r, g, b) {
  /* Find the color in the 8-bit ANSI escape 'palette' which matches closest */
  var closestColor = 0;
  var minDist = r*r + g*g + b*b; /* Distance in RGB 'space' from black */
  for (var i = 1; i < palette.length; i++) {
    var dist = rgbDistanceSquared(r, g, b, palette[i]);
    if (dist < minDist) {
      minDist = dist;
      closestColor = i;
    }
  }
  return `\x1B[38;5;${closestColor}m`;
}

function colorEscape24Bit(r, g, b) {
  return `\x1B[38;2;${r};${g};${b}m`;
}

module.exports.colorEscape8Bit = colorEscape8Bit;
module.exports.colorEscape24Bit = colorEscape24Bit;
