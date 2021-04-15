'use strict';

const arithmetic = require("../arithmetic.js");

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

/* Test sequence from JPEG spec, K.4.1 */
const coder1 = new arithmetic.Coder(1);
coder1.encodeUInt(0x00020051, 32, 0);
coder1.encodeUInt(0x000000C0, 32, 0);
coder1.encodeUInt(0x0352872A, 32, 0);
coder1.encodeUInt(0xAAAAAAAA, 32, 0);
coder1.encodeUInt(0x82C02000, 32, 0);
coder1.encodeUInt(0xFCD79EF6, 32, 0);
coder1.encodeUInt(0x74EAABF7, 32, 0);
coder1.encodeUInt(0x697EE74C, 32, 0);
const result1 = coder1.flush();
const expected1 = [
  101,  91,  81,  68, 247, 150, 157, 81, 120,  85, 191, 255,   0, 252,
   81, 132, 199, 206, 249,  57,   0, 40, 125,  70, 112, 142, 203, 192, 246
];

assertArray(result1, expected1);

/* Remove byte-stuffing from input */
result1.splice(12, 1);
/* Feed the encoder output into the decoder */
const decoder1 = new arithmetic.Decoder(1, result1);
assertEquals(decoder1.decodeUInt(32, 0), 0x00020051);
assertEquals(decoder1.decodeUInt(32, 0), 0x000000C0);
assertEquals(decoder1.decodeUInt(32, 0), 0x0352872A);
assertEquals(decoder1.decodeUInt(32, 0), 0xAAAAAAAA);
assertEquals(decoder1.decodeUInt(32, 0), 0x82C02000);
assertEquals(decoder1.decodeUInt(32, 0), 0xFCD79EF6);
assertEquals(decoder1.decodeUInt(32, 0), 0x74EAABF7);
assertEquals(decoder1.decodeUInt(32, 0), 0x697EE74C);

console.log('OK!');
