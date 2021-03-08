'use strict'

function equals(a, b) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b))
      return false;
    return a.length == b.length && a.every((val, idx) => equals(val, b[idx]));
  } else {
    return a === b;
  }
}

function describeDifference(array1, array2) {
  if (array1.length != array2.length)
    return `Length is different: ${array1.length} vs ${array2.length}`;
  for (var i = 0; i < array1.length; i++)
    if (!equals(array1[i], array2[i]))
      return `Index ${i} is different: ${array1[i]} vs ${array2[i]}`;
}

function assertArray(actual, expected) {
  if (!Array.isArray(actual))
    throw new Error(`expected ${actual} to be an array`);
  if (!equals(actual, expected))
    throw new Error(`expected ${actual} to be ${expected}. ${describeDifference(actual, expected)}`);
}

function assertEquals(a, b) {
  if (a !== b)
    throw new Error(`expected ${a} to === ${b}`);
}

const { JPEG } = require('../jpeg.js');
var jpg = new JPEG();

/* Sample Huffman table from JPEG spec, K.3.3.1
 * Ensure we can decode it correctly */
var buf = Buffer.from([0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
var tbl = jpg.readHuffmanTable(buf, 0);
assertEquals(tbl.number, 0);
assertEquals(tbl.type, 0);
assertEquals(tbl.codes.get('00'), 0);
assertEquals(tbl.codes.get('010'), 1);
assertEquals(tbl.codes.get('011'), 2);
assertEquals(tbl.codes.get('100'), 3);
assertEquals(tbl.codes.get('101'), 4);
assertEquals(tbl.codes.get('110'), 5);
assertEquals(tbl.codes.get('1110'), 6);
assertEquals(tbl.codes.get('11110'), 7);
assertEquals(tbl.codes.get('111110'), 8);
assertEquals(tbl.codes.get('1111110'), 9);
assertEquals(tbl.codes.get('11111110'), 10);
assertEquals(tbl.codes.get('111111110'), 11);

/* Test some helper routines */
var buf = Buffer.from([0xA6, 0x35]);
assertArray(jpg.readBits(buf, 0, 0, 0), [0, 0, 0]);
assertArray(jpg.readBits(buf, 0, 0, 3), [0, 3, 5]);
assertArray(jpg.readBits(buf, 0, 0, 8), [1, 0, 0xA6]);
assertArray(jpg.readBits(buf, 0, 0, 10), [1, 2, 0xA6 << 2]);
assertArray(jpg.readBits(buf, 0, 0, 16), [2, 0, 0xA635]);

assertArray(jpg.readBits(buf, 0, 1, 0), [0, 1, 0]);
assertArray(jpg.readBits(buf, 0, 1, 3), [0, 4, 2]);
assertArray(jpg.readBits(buf, 0, 1, 7), [1, 0, 0x26]);
assertArray(jpg.readBits(buf, 0, 1, 8), [1, 1, 0x26 << 1]);

assertArray(jpg.readBits(buf, 1, 0, 4), [1, 4, 3]);
assertArray(jpg.readBits(buf, 1, 1, 3), [1, 4, 3]);
assertArray(jpg.readBits(buf, 1, 1, 7), [2, 0, 0x35]);

/* Try decoding very simple JPEGs
 * The first ones are just solid colors */
const fs = require('fs');
var [jpg1, raster1] = JPEG.fromBytes(fs.readFileSync(__dirname + '/8x8-black-GIMP-basic.jpg'));
assertArray(Array.from(raster1), new Array(64 * 3).fill(0));

var [jpg2, raster2] = JPEG.fromBytes(fs.readFileSync(__dirname + '/8x8-white-GIMP-basic.jpg'));
assertArray(Array.from(raster2), new Array(64 * 3).fill(255));

var array3 = new Array(64 * 3);
for (var i = 0; i < 64*3; i += 3) {
  array3[i] = 238;
  array3[i+1] = 40;
  array3[i+2] = 41;
}
var [jpg3, raster3] = JPEG.fromBytes(fs.readFileSync(__dirname + '/8x8-red-drawing.jpg'));
assertArray(Array.from(raster3), array3);

/* Then stripes of various widths
 * First vertical stripes */
var array4 = [];
for (var i = 0; i < 8; i++)
  array4 = array4.concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 254, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
var [jpg4, raster4] = JPEG.fromBytes(fs.readFileSync(__dirname + '/8x8-black-white-1.jpg'));
assertArray(Array.from(raster4), array4);

/* Horizontal stripes */
var array5 = [];
array5 = array5.concat(new Array(16*3).fill(255));
array5 = array5.concat(new Array(16*3).fill(1));
array5 = array5.concat(new Array(16*3).fill(255));
array5 = array5.concat(new Array(16*3).fill(1));
var [jpg5, raster5] = JPEG.fromBytes(fs.readFileSync(__dirname + '/8x8-black-white-2.jpg'));
assertArray(Array.from(raster5), array5);

/* 16x16 with 4 colors */
var array6 = [];
for (var i = 0; i < 8; i++)
  array6 = array6.concat([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 241, 15, 39,
    241, 15, 39, 241, 15, 39, 241, 15, 39, 241, 15, 39, 241, 15, 39, 241, 15, 39, 241, 15, 39]);
for (var i = 0; i < 8; i++)
  array6 = array6.concat([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 1, 1, 223, 1, 1, 223, 1, 1, 223, 1, 1, 223, 1, 1, 223, 1, 1, 223, 1, 1, 223, 1, 1, 223]);
var [jpg6, raster6] = JPEG.fromBytes(fs.readFileSync(__dirname + '/16x16-four-colors.jpg'));
assertArray(Array.from(raster6), array6);

/* Sampling factor no longer 1:1:1
 * Samples for different image components need to be aligned correctly */
var array7 = [
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
  241,  15,  39, 241,  15,  39, 241,  15,  39, 241,  15,  39,
  241,  15,  39, 241,  15,  39, 241,  14,  39, 241,  14,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
  241,  15,  39, 241,  15,  39, 241,  15,  39, 241,  15,  39,
  241,  15,  39, 241,  15,  39, 241,  14,  39, 241,  14,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
  241,  15,  39, 241,  15,  39, 240,  15,  39, 240,  15,  39,
  240,  15,  40, 240,  15,  40, 241,  15,  39, 241,  15,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
  241,  15,  39, 241,  15,  39, 240,  15,  39, 240,  15,  39,
  240,  15,  40, 240,  15,  40, 241,  15,  39, 241,  15,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   0,   1,   1,   0,   1,   1,
  241,  15,  39, 241,  15,  39, 240,  15,  39, 240,  15,  39,
  240,  15,  39, 240,  15,  39, 241,  15,  39, 241,  15,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   1,   1,   1,   1,   0,   1,   1,   0,   1,   1,
  241,  15,  39, 241,  15,  39, 240,  15,  39, 240,  15,  39,
  240,  15,  39, 240,  15,  39, 241,  15,  39, 241,  15,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   2,   1,   1,   2,   1,   1,   2,   1,   1,   2,
  241,  14,  38, 241,  14,  38, 241,  15,  39, 241,  15,  39,
  241,  15,  39, 241,  15,  39, 241,  14,  39, 241,  14,  39,
    1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,
    1,   1,   2,   1,   1,   2,   1,   1,   2,   1,   1,   2,
  241,  14,  38, 241,  14,  38, 241,  15,  39, 241,  15,  39,
  241,  15,  39, 241,  15,  39, 241,  14,  39, 241,  14,  39,
  255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 254,
  255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 254,
    1,   1, 223,   1,   1, 223,   0,   1, 223,   0,   1, 223,
    1,   1, 223,   1,   1, 223,   1,   1, 222,   1,   1, 222,
  255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 254,
  255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 254,
    1,   1, 223,   1,   1, 223,   0,   1, 223,   0,   1, 223,
    1,   1, 223,   1,   1, 223,   1,   1, 222,   1,   1, 222,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    1,   1, 223,   1,   1, 223,   1,   1, 222,   1,   1, 222,
    1,   0, 223,   1,   0, 223,   1,   1, 223,   1,   1, 223,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    1,   1, 223,   1,   1, 223,   1,   1, 222,   1,   1, 222,
    1,   0, 223,   1,   0, 223,   1,   1, 223,   1,   1, 223,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 254, 255, 255, 254, 255, 255,
    1,   0, 223,   1,   0, 223,   1,   1, 223,   1,   1, 223,
    1,   1, 222,   1,   1, 222,   1,   1, 223,   1,   1, 223,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 254, 255, 255, 254, 255, 255,
    1,   0, 223,   1,   0, 223,   1,   1, 223,   1,   1, 223,
    1,   1, 222,   1,   1, 222,   1,   1, 223,   1,   1, 223,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    1,   1, 223,   1,   1, 223,   0,   1, 222,   0,   1, 222,
    1,   1, 223,   1,   1, 223,   1,   1, 223,   1,   1, 223,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    1,   1, 223,   1,   1, 223,   0,   1, 222,   0,   1, 222,
    1,   1, 223,   1,   1, 223,   1,   1, 223,   1,   1, 223
]
var [jpg7, raster7] = JPEG.fromBytes(fs.readFileSync(__dirname + '/16x16-different-sampling-factor.jpg'));
assertArray(Array.from(raster7), array7);

console.log("OK!");
