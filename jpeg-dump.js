'use strict'

const fs = require('fs');
const { JPEG } = require('./jpeg.js');
const jpg = new JPEG();

const filename = process.argv[2];
const data = fs.readFileSync(filename);

var i = 0;
while (true) {
  i = data.indexOf(0xFF, i+1);
  if (i == -1)
    break;

  const marker = data[i+1];

  if (marker === 0xFF)
    continue; /* The previous 0xFF byte was a fill byte */

  if (marker === 0)
    continue; /* 'Byte-stuffing' for entropy-encoded data */

  const type = JPEG.markers.get(marker);
  const offset = `0x${i.toString(16).padStart(6, '0')}`;

  if (!type) {
    console.log(`${offset}: unknown marker type 0x${marker.toString(16).padStart(2, '0')}`);
    continue;
  }

  switch (marker) {
    case 0xC0: case 0xC1: case 0xC2: case 0xC3: /* Start of Frame */
    case 0xC5: case 0xC6: case 0xC7: case 0xC8:
    case 0xC9: case 0xCA: case 0xCB: case 0xCD:
    case 0xCE: case 0xCF:
      console.log(`${offset}: ${type}`);
      jpg.dumpFrameHeader(data, i);
      jpg.handleFrameHeader(data, i); /* Needed for later scan header */
      break;

    case 0xC4: /* Huffman tables */
      console.log(`${offset}: Huffman tables`)
      jpg.dumpHuffmanSegment(data, i);
      break;

    case 0xCC: /* Arithmetic coding conditioning tables */
      console.log(`${offset}: Arithmetic coding conditioning tables`);
      jpg.dumpConditioningSegment(data, i);
      break;

    case 0xDA: /* Start of Scan */
      console.log(`${offset}: Start of Scan`);
      jpg.dumpScanHeader(data, i);
      break;

    case 0xDB: /* Quantization Tables */
      console.log(`${offset}: Quantization tables`);
      i = jpg.dumpQuantizationSegment(data, i) - 1;
      break;

    case 0xDD: /* Define Restart Interval */
      console.log(`${offset}: Define Restart Interval`);
      jpg.dumpRestartInterval(data, i);
      break;

    case 0xE0: /* JFIF header */
      console.log(`${offset}: JFIF header`);
      jpg.dumpJfifHeader(data, i);
      break;

    case 0xE1: /* EXIF header */
      console.log(`${offset}: EXIF header`);
      jpg.dumpExifHeader(data, i);
      break;

    case 0xE2: /* ICC color profile */
      console.log(`${offset}: ICC color profile`);
      jpg.dumpICCColorProfile(data, i);
      break;

    case 0xEE: /* Adobe color profile */
      console.log(`${offset}: Adobe color profile`);
      jpg.dumpAdobeColorProfile(data, i);
      break;

    case 0xFE: /* Comment */
      const commentEnd = data.indexOf(0xFF, i+2);
      /* I found a comment which started with 0x00 0x0D... the use of index `i+4`
       * below is intended to skip over those bytes */
      if (commentEnd !== -1)
        console.log(`${offset}: Comment: ${data.toString('utf8', i+4, commentEnd)}`);
      else
        console.log(`${offset}: Malformed comment`);
      break;

    default:
      console.log(`${offset}: ${type}`);
  }
}
