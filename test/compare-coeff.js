#!/usr/bin/env node

'use strict';

const exec   = require('child_process').execSync;
const fs     = require('fs');
const assert = require ('assert/strict');

const output = exec(`${__dirname}/jpeg-coefficients ${process.argv[2]}`);
const coeffs = JSON.parse(output);

const { JPEG } = require('../jpeg.js');
const rawjpeg = fs.readFileSync(process.argv[2]);
const [jpg, raster] = JPEG.fromBytes(rawjpeg);

assert.deepEqual(jpg.coefficients, coeffs);
