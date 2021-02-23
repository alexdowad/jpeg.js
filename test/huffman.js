'use strict'

const { prepareDecoder, decodeBuffer, decodeOne } = require("../huffman.js");

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

/* Very simple test first */
var map = new Map([['00', 1], ['010', 2], ['011', 3]]);
var decoder = prepareDecoder(map);
assertArray(
  decodeBuffer(Buffer.from("\x00\x4F", 'binary'), 0, 2, decoder),
  [1, 1, 1, 1, 2, 3]);
assertArray(
  decodeOne(Buffer.from("\x02\x4F", 'binary'), 0, 2, 5, decoder),
  [1, 0, 2]);
assertArray(
  decodeOne(Buffer.from("\x02\x4F", 'binary'), 0, 2, 4, decoder),
  [0, 6, 1]);

/* Regression test for bug in handling of longer bitstrings */
map = new Map([
  ['00', 1],
  ['01', 2],
  ['100', 3],
  ['1111111111000000', 148],
]);
decoder = prepareDecoder(map);
assertArray(
  decodeOne(Buffer.from("\x37\xFE\x00", 'binary'), 0, 3, 5, decoder),
  [2, 5, 148]);
