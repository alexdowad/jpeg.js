'use strict'

/* Show a preview of a JPEG file in the terminal, using ANSI color escapes */

const fs = require('fs');
const { JPEG } = require('./jpeg.js');
const colorEscape = require('./ansi-escapes.js').colorEscape24Bit;

const filename = process.argv[2];
const data = fs.readFileSync(filename);

const [jpg, raster] = JPEG.fromBytes(data);

const displayWidth = Math.min(jpg.frameData.width, 80);
const displayHeight = Math.min(jpg.frameData.height, 30);

for (var y = 0; y < displayHeight; y++) {
  for (var x = 0; x < displayWidth; x++) {
    const rasterIndex = ((y * jpg.frameData.width) + x) * 3;
    const r = raster[rasterIndex];
    const g = raster[rasterIndex+1];
    const b = raster[rasterIndex+2];
    process.stdout.write(colorEscape(r, g, b) + "\u{2588}");
  }
  process.stdout.write("\n");
}
