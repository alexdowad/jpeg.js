#!/usr/bin/env node

'use strict';

const exec   = require('child_process').execSync;
const fs     = require('fs');
const assert = require ('assert/strict');

exec(`${__dirname}/random-jpeg 8 8 /tmp/random.jpg`, {encoding: 'binary'});
const output  = exec(`${__dirname}/decode-jpeg /tmp/random.jpg`);
const samples = JSON.parse(output);

const { JPEG } = require('../jpeg.js');
const rawjpeg = fs.readFileSync('/tmp/random.jpg');
const [jpg, raster] = JPEG.fromBytes(rawjpeg);

assert.equal(samples, Array.from(raster));
