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

function assertArray(actual, expected) {
  if (!Array.isArray(actual))
    throw new Error(`expected ${actual} to be an array`);
  if (!equals(actual, expected))
    throw new Error(`expected ${actual} to be ${expected}`);
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
