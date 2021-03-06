'use strict'

const huffman = require('./huffman.js');

class JPEG {
  /* In a JPEG file, any byte which follows 0xFF is a marker */
  static markers = new Map([
    [0xC0, 'Start of Frame (baseline DCT)'],
    [0xC1, 'Start of Frame (extended sequential DCT)'],
    [0xC2, 'Start of Frame (progressive DCT)'],
    [0xC3, 'Start of Frame (lossless sequential)'],
    [0xC4, 'Define Huffman Tables'],
    [0xC5, 'Start of Frame (differential sequential DCT)'],
    [0xC6, 'Start of Frame (differential progressive DCT)'],
    [0xC7, 'Start of Frame (differential lossless sequential)'],
    [0xC9, 'Start of Frame (extended sequential DCT, arithmetic-coded)'],
    [0xCA, 'Start of Frame (progressive DCT, arithmetic-coded)'],
    [0xCB, 'Start of Frame (lossless sequential, arithmetic-coded'],
    [0xCC, 'Define Arithmetic Coding Conditionings'],
    [0xCD, 'Start of Frame (differential sequential DCT, arithmetic-coded)'],
    [0xCE, 'Start of Frame (differential progressive DCT, arithmetic-coded)'],
    [0xCF, 'Start of Frame (differential lossless sequential, arithmetic-coded)'],
    [0xD0, 'Restart 0'],
    [0xD1, 'Restart 1'],
    [0xD2, 'Restart 2'],
    [0xD3, 'Restart 3'],
    [0xD4, 'Restart 4'],
    [0xD5, 'Restart 5'],
    [0xD6, 'Restart 6'],
    [0xD7, 'Restart 7'],
    [0xD8, 'Start of Image'],
    [0xD9, 'End of Image'],
    [0xDA, 'Start of Scan'],
    [0xDB, 'Define Quantization Tables'],
    [0xDC, 'Define Number of Lines'],
    [0xDD, 'Define Restart Interval'],
    [0xE0, 'Application-Specific (JFIF header)'],
    [0xE1, 'Application-Specific (EXIF header)'],
    [0xFE, 'Comment']
  ]);

  static densityFields = new Map([
    [0, 'no units'],
    [1, 'pixels per inch'],
    [2, 'pixels per cm']
  ]);

  static fromBytes = function(buffer) {
    const jpg = new JPEG();

    var i = 0;
    while (true) {
      i = buffer.indexOf(0xFF, i+2);
      if (i == -1)
        break;

      const marker = buffer[i+1];
      if (marker === 0xFF || marker === 0)
        continue;

      switch (marker) {
        case 0xC0: case 0xC1: case 0xC2: case 0xC3:
        case 0xC5: case 0xC6: case 0xC7: case 0xC8:
        case 0xC9: case 0xCA: case 0xCB: case 0xCD:
        case 0xCE: case 0xCF:
          jpg.handleFrameHeader(buffer, i);
          break;

        case 0xC4:
          jpg.handleHuffmanSegment(buffer, i);
          break;

        case 0xDB:
          jpg.handleQuantizationSegment(buffer, i);
          break;

        case 0xDA:
          const raster = jpg.readBaselineScan(buffer, i);
          return [jpg, raster];
      }
    }

    return [jpg, undefined];
  }

  constructor() {
    this.dcTables = [];
    this.acTables = [];
    this.dcDecoders = [];
    this.acDecoders = [];
    this.quantTables = [];
    this.frameData = undefined;
  }

  /* JFIF/EXIF file header */

  readJfifHeader(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFE0)
      throw new Error("Invalid JFIF header (wrong marker)");
    if (buffer.toString('binary', index+4, index+8) !== 'JFIF') {
      /* This is not a JFIF header; however, this does not violate the JPEG spec,
       * since an APP0 segment can be used by individual applications for anything
       * they want */
       return {};
    }

    return {
      majorVersion: buffer[index+9],
      minorVersion: buffer[index+10],
      densityField: JPEG.densityFields.get(buffer[index+11]), /* unit of pixel density; pixels per inch/cm/etc. */
      horizDensity: buffer.readUInt16BE(index+12),
      vertDensity: buffer.readUInt16BE(index+14),
      thumbnailWidth: buffer[index+16],
      thumbnailHeight: buffer[index+17]
    };
  }

  dumpJfifHeader(buffer, index) {
    console.group();
    console.log(this.readJfifHeader(buffer, index));
    console.groupEnd();
  }

  /* Start of Frame */

  readFrameHeader(buffer, index) {
    const marker      = buffer[index+1];
    const lossless    = (marker == 0xC3 || marker == 0xC7 || marker == 0xCB);
    const extended    = (marker == 0xC1 || marker == 0xC9);
    const progressive = (marker == 0xC2 || marker == 0xC6 || marker == 0xCA || marker == 0xCE);
    const arithmetic  = (marker >= 0xC9);
    const differential = (marker == 0xC5 || marker == 0xC6 || marker == 0xC7 || marker == 0xCD || marker == 0xCE ||  marker == 0xCF);

    const length      = buffer.readUInt16BE(index+2);
    const precision   = buffer[index+4];
    const pixelHeight = buffer.readUInt16BE(index+5);
    const pixelWidth  = buffer.readUInt16BE(index+7);
    /* A 'component' is a color channel; basically, something with one number (or 'sample')
     * for each pixel in the image */
    var   nComponents = buffer[index+9];
    const components  = new Array(nComponents);

    index += 10;
    while (nComponents-- > 0) {
      const componentId   = buffer[index];
      /* Components with a larger sampling factor have higher resolution
       *
       * If a component has the highest sampling factor of all components in a certain
       * dimension (either X or Y), the number of samples it has for each line in that
       * dimension equals the pixel width or height of the image as a whole.
       *
       * But if a component has _less_ than the highest sampling factor in a dimension,
       * the number of samples it has per line will be divided by the same factor
       * (For example, if the first component has sampling factor 2 and the second, 1,
       *  then the second will have half as many samples per line, or half resolution) */
      const horizSampling = buffer[index+1] >> 4;
      const vertSampling  = buffer[index+1] & 0xF;
      const quantTableIdx = buffer[index+2];
      components[componentId-1] = {id: componentId, quantTable: quantTableIdx, horizSampling: horizSampling, vertSampling: vertSampling};
      index += 3;
    }

    return {
      extended: extended,
      progressive: progressive,
      coding: arithmetic ? 'arithmetic' : 'huffman',
      differential: differential,
      lossless: lossless,
      precision: precision,
      width: pixelWidth,
      height: pixelHeight,
      components: components
    };
  }

  dumpFrameHeader(buffer, index) {
    console.group();
    console.log(this.readFrameHeader(buffer, index));
    console.groupEnd();
  }

  handleFrameHeader(buffer, index) {
    this.frameData = this.readFrameHeader(buffer, index);
  }

  /* Huffman Tables */

  readHuffmanTable(buffer, index) {
    /* 1 byte for table properties */
    const tableClass  = buffer[index] >> 4; /* 0 is DC, 1 is AC */
    const tableNumber = buffer[index] & 0xF;

    /* 16 bytes for the # of codes of each possible bit length (from 1-16)
     * Then the symbol values which correspond to each code follow, 1 byte each */
    const codes = new Map();
    var   nextCode = 0, nextValueIndex = index + 17;

    for (var codeLen = 1; codeLen <= 16; codeLen++) {
      var nCodes = buffer[index + codeLen]; /* How many Huffman codes of this bit length? */

      while (nCodes-- > 0) {
        /* The bitstrings used as Huffman codes are generated in a specific order */
        const bitString = nextCode.toString(2).padStart(codeLen, '0');
        codes.set(bitString, buffer[nextValueIndex++]);
        nextCode++;
      }

      nextCode <<= 1;
    }

    return {type: tableClass, number: tableNumber, codes: codes, start: index, end: nextValueIndex};
  }

  /* `index` points at segment marker */
  handleHuffmanSegment(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFC4)
      throw new Error("Invalid Huffman segment (wrong marker)");
    /* Segment length includes 2 bytes for marker, 2 for length field */
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    index += 4;
    while (index < end) {
      const table = this.readHuffmanTable(buffer, index);
      if (table.type) {
        this.acTables[table.number] = table;
        this.acDecoders[table.number] = huffman.prepareDecoder(table.codes);
      } else {
        this.dcTables[table.number] = table;
        this.dcDecoders[table.number] = huffman.prepareDecoder(table.codes);
      }
      index = table.end;
    }
  }

  dumpHuffmanSegment(buffer, index) {
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    index += 4;
    while (index < end) {
      const table = this.readHuffmanTable(buffer, index);
      console.group();
      console.log(`Huffman table class: ${table.type ? 'AC' : 'DC'}, Number: ${table.number}`);
      console.log(table.codes);
      console.groupEnd();
      index = table.end;
    }
  }

  /* Quantization Tables */

  readQuantizationTable(buffer, index) {
    const precision   = (buffer[index] >> 4) == 0 ? 8 : 16 /* Bits per value */
    const tableNumber = buffer[index] & 0xF;

    if (precision == 16) {
      const values = [];
      for (var offset = 1; offset <= 128; offset += 2) {
        values.push(buffer.readUInt16BE(index + offset));
      }
      return {precision: 16, number: tableNumber, values: values, start: index, end: index + 129};
    } else {
      const values = Array.from(buffer.slice(index+1, index+65));
      return {precision: 8, number: tableNumber, values: values, start: index, end: index + 65};
    }
  }

  dumpQuantizationSegment(buffer, index) {
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    index += 4;
    while (index < end) {
      const table = this.readQuantizationTable(buffer, index);
      console.group();
      console.log(`Quantization table number: ${table.number}, Precision: ${table.precision}`);
      console.log(table.values);
      console.groupEnd();
      index = table.end;
    }
  }

  handleQuantizationSegment(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFDB)
      throw new Error("Invalid quantization tables segment (wrong marker)");
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    index += 4;
    while (index < end) {
      const table = this.readQuantizationTable(buffer, index);
      this.quantTables[table.number] = table;
      index = table.end;
    }
  }

  dequantizeDcCoefficient(dcCoeff, quantTable) {
    return dcCoeff * quantTable[0];
  }

  dequantizeAcCoefficients(acCoeff, quantTable) {
    for (var i = 0; i < acCoeff.length; i++)
      acCoeff[i] *= quantTable[i+1];
    return acCoeff;
  }

  /* Scan header */

  readScanHeader(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFDA)
      throw new Error("Invalid scan header (wrong marker)");
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    var nComponents = buffer[index+4];
    var components  = [];

    index += 5;
    while (nComponents-- > 0) {
      components.push({
        id: buffer[index],
        dcTable: buffer[index+1] >> 4,
        acTable: buffer[index+1] & 0xF
      });
      index += 2;
    }

    if (index < end) {
      /* The remaining values in the scan header are only needed for progressive
       * or lossless JPEGs */
      const selectionStart = buffer[index];
      const selectionEnd   = buffer[index+1];
      const approxBitPos   = buffer[index+2];
      if (this.frameData.progressive) {
        return {
          components: components,
          spectralStart: selectionStart,
          spectralEnd: selectionEnd,
          approxBitHigh: approxBitPos >> 4,
          approxBitLow: approxBitPos & 0xF
        };
      } else if (this.frameData.lossless) {
        return {
          components: components,
          predictor: selectionEnd,     /* This field has different meaning for lossless JPEGs */
          pointTransform: approxBitPos /* Likewise */
        };
      } else if (selectionStart || (selectionEnd !== 63) || approxBitPos) {
        /* The last scan header fields should have fixed values for sequential DCT-based JPEGs */
        throw new Error("Unexpected values in scan header");
      }
    }

    return {components: components};
  }

  dumpScanHeader(buffer, index) {
    console.group();
    console.log(this.readScanHeader(buffer, index));
    console.groupEnd();
  }

  readBaselineScan(buffer, index) {
    const header = this.readScanHeader(buffer, index);
    index += buffer.readUInt16BE(index+2); /* Go past end of scan header */
    index += 2;

    /* Result, in 24-bit RGB format (3 successive bytes per pixel) */
    const raster = Buffer.alloc(3 * this.frameData.width * this.frameData.height);

    /* ECS encodes a series of "MCUs" or "minimum coded units"
     *
     * Each MCU consists of (horizontalScalingFactor * verticalScalingFactor) 8x8 blocks
     * for component 1, then for component 2... up to the last component
     */
    var blocksPerMcu = 0, maxHorizSampling = 0, maxVertSampling = 0;
    for (var component of header.components) {
      const componentData = this.frameData.components[component.id-1];
      blocksPerMcu += componentData.horizSampling * componentData.vertSampling;
      maxHorizSampling = Math.max(maxHorizSampling, componentData.horizSampling);
      maxVertSampling = Math.max(maxVertSampling, componentData.vertSampling);
    }
    const samples = new Array(blocksPerMcu);
    const mcuPxWidth = 8 * maxHorizSampling;
    const mcuPxHeight = 8 * maxVertSampling;
    const expectedMcus = Math.ceil(this.frameData.width / mcuPxWidth) * Math.ceil(this.frameData.height / mcuPxHeight);

    /* Decode any number of entropy-coded segments delimited by restart markers */
    while (true) {
      /* Search for end of this entropy-coded segment */
      var ecsEnd = buffer.indexOf(0xFF, index);
      while (ecsEnd !== -1 && buffer[ecsEnd+1] == 0) /* byte stuffing */
        ecsEnd = buffer.indexOf(0xFF, ecsEnd+2);
      if (ecsEnd === -1)
        throw new Error("Unterminated scan section");

      /* Extract data for ECS and remove byte stuffing (convert 0xFF00 -> 0xFF) */
      const ecs = Buffer.allocUnsafe(ecsEnd - index);
      buffer.copy(ecs, 0, index, ecsEnd);
      this.removeByteStuffing(ecs);

      /* For each image component, we need to track the last DC coefficient seen within
       * the current scan; it is used to help calculate the next DC coefficient */
      var prevDcCoeffs = new Array(header.components.length).fill(0);

      /* Decode enough blocks to form a complete MCU, then enter the pixel values in `raster`
       * Then start again on the next MCU, until we reach the end of this ECS */
      var bytePos = 0, bitPos = 0, mcuNumber = 0;
      while (mcuNumber < expectedMcus && bytePos < ecs.length) {
        var blockIndex = 0;

        /* The scan header tells us which image components are present in this scan,
         * and in which order. Follow the specified order */
        for (var componentIndex = 0; componentIndex < header.components.length; componentIndex++) {
          const component   = header.components[componentIndex];
          const horizBlocks = this.frameData.components[component.id-1].horizSampling;
          const vertBlocks  = this.frameData.components[component.id-1].vertSampling;
          const dcDecoder   = this.dcDecoders[component.dcTable];
          const acDecoder   = this.acDecoders[component.acTable];
          const quantTable  = this.quantTables[this.frameData.components[component.id-1].quantTable].values;
          const prevDcCoeff = prevDcCoeffs[componentIndex];

          for (var i = 0; i < vertBlocks; i++) {
            for (var j = 0; j < horizBlocks; j++) {
              var dcCoefficient, acCoefficients;
              [bytePos, bitPos, dcCoefficient, acCoefficients] = this.readSampleBlock(ecs, bytePos, bitPos, ecs.length, prevDcCoeff, dcDecoder, acDecoder);
              prevDcCoeffs[componentIndex] = dcCoefficient;

              /* Entropy-coded data has been decoded to DCT (discrete cosine transform) coefficients;
               * Now convert those coefficients back to an array of color samples */
              dcCoefficient  = this.dequantizeDcCoefficient(dcCoefficient, quantTable);
              acCoefficients = this.inverseZigzagOrder(this.dequantizeAcCoefficients(acCoefficients, quantTable));
              samples[blockIndex++] = this.inverseDCT(dcCoefficient, acCoefficients);
            }
          }
        }

        /* Got one whole MCU, now convert samples to RGB color space and fill in raster
         * First figure out where in the raster these pixels are located */
        const xStart = (mcuNumber % Math.ceil(this.frameData.width / mcuPxWidth)) * mcuPxWidth;
        const yStart = Math.floor(mcuNumber / Math.ceil(this.frameData.width / mcuPxWidth)) * mcuPxHeight;

        if (header.components.length == 3) {
          if (maxHorizSampling == 1 && maxVertSampling == 1) {
            /* All image components have the same resolution */
            for (var y = yStart; y < yStart + 8; y++) {
              for (var x = xStart; x < xStart + 8; x++) {
                const rasterIndex = ((y * this.frameData.width) + x) * 3;
                this.convertYCbCrtoRGB(raster, rasterIndex, samples[0][y*8 + x], samples[1][y*8 + x], samples[2][y*8 + x]);
              }
            }
          } else {
            /* Some image components have different resolution from others; we need
             * to 'align' the corresponding samples in each image component before
             * performing the color space conversion */
            const alignedSamples = this.alignSamples(header.components, samples, mcuPxWidth, mcuPxHeight, maxHorizSampling, maxVertSampling);

            for (var y = yStart; y < yStart + mcuPxHeight; y++) {
              for (var x = xStart; x < xStart + mcuPxWidth; x++) {
                const rasterIndex = ((y * this.frameData.width) + x) * 3;
                this.convertYCbCrtoRGB(raster, rasterIndex, alignedSamples[0][y*mcuPxWidth + x], alignedSamples[1][y*mcuPxWidth + x], alignedSamples[2][y*mcuPxWidth + x]);
              }
            }
          }
        } else if (header.components.length == 1) {
          /* Luminance-only (grayscale) color space */
          for (var y = yStart; y < yStart + 8; y++) {
            for (var x = xStart; x < xStart + 8; x++) {
              const rasterIndex = ((y * this.frameData.width) + x) * 3;
              raster[rasterIndex] = raster[rasterIndex+1] = raster[rasterIndex+2] = samples[0][y*8 + x];
            }
          }
        } else {
          throw new Error("Unknown color space");
        }

        mcuNumber++;
      }

      if (buffer[ecsEnd+1] >= 0xD0 && buffer[ecsEnd+1] <= 0xD7) {
        /* Restart marker; continue decoding the scan data
         * Note that "previous DC coefficients" are reset to zero after each restart;
         * that's why we re-initialize the `prevDcCoeffs` array above */
        index = ecsEnd+2;
      } else {
        break;
      }
    }

    return raster;
  }

  readProgressiveScan(buffer, index) {
    throw new Error("Not implemented yet");
  }

  /* JPEG encodes 0xFF bytes in compressed data as 0xFF00;
   * reverse that encoding to recover the original compressed data
   *
   * This function modifies contents of `buffer` */
  removeByteStuffing(buffer) {
    var ff = buffer.indexOf(0xFF, 0);
    if (ff === -1 || buffer[ff+1] !== 0)
      return buffer; /* Nothing to remove */
    var searchIndex = ff+2; /* Where to start next search for 0xFF */

    while (true) {
      var ff2 = buffer.indexOf(0xFF, searchIndex);

      if (ff2 == -1 || buffer[ff2+1] !== 0) {
        /* We are finished, just need to copy down any trailing bytes and trim buffer length */
        buffer.copy(buffer, ff+1, searchIndex);
        return buffer.slice(0, ff + buffer.length - searchIndex + 1);
      } else {
        /* Copy down the next range of good data, overwriting unwanted zero byte */
        buffer.copy(buffer, ff+1, searchIndex, ff2+1);
      }

      ff = ff + ff2 - searchIndex + 1; /* Position which 0xFF was just copied down to */
      searchIndex = ff2+2; /* Where next range of good bytes starts from */
    }
  }

  /* When different image components have a different resolution, take one MCU's
   * worth of 8x8 blocks of samples and scale each component as needed so all are
   * at the same resolution */
  alignSamples(components, samples, mcuPxWidth, mcuPxHeight, maxHorizSampling, maxVertSampling) {
    const result = new Array(components.length);

    var blockIndex = 0;
    for (var i = 0; i < components.length; i++) {
      const array = result[i] = new Array(mcuPxWidth * mcuPxHeight);
      const component = components[i];
      const componentData = this.frameData.components[component.id-1];
      const horizSampling = componentData.horizSampling;
      const vertSampling  = componentData.vertSampling;
      /* Iterate over blocks which carry data for this image component */
      for (var blockY = 0; blockY < vertSampling; blockY++) {
        for (var blockX = 0; blockX < horizSampling; blockX++) {
          const block  = samples[blockIndex++];
          const xScale = maxHorizSampling / horizSampling;
          const yScale = maxVertSampling  / vertSampling;
          const xShift = Math.log2(xScale);
          const yShift = Math.log2(yScale);
          for (var y = 0; y < 8 * yScale; y++) {
            for (var x = 0; x < 8 * xScale; x++) {
              array[(y + (blockY * 8 * yScale))*mcuPxWidth + (x + (blockX * 8 * xScale))] = block[(y >> yShift)*8 + (x >> xShift)];
            }
          }
        }
      }
    }

    return result;
  }

  /* Entropy coded segments */

  /* This is only for Huffman-encoded blocks! */
  readSampleBlock(buffer, index, bitIndex, end, prevDcCoeff, dcDecoder, acDecoder) {
    /* First find the DC coefficient for this 8x8 block of samples
     *
     * It is encoded as a 'magnitude category' (which is entropy-coded)
     * and some subsequent bits
     * The number of subsequent bits to read is equal to the numeric value of
     * the magnitude category
     * Category 0 is for value 0 only, category 1 is for -1 and 1, category 2
     * is for -3, -2, 2, and 3, etc...
     *
     * Further, it is offset by the value of the DC coefficient for the previous block */
    var magnitude, extraBits;
    [index, bitIndex, magnitude] = huffman.decodeOne(buffer, index, end, bitIndex, dcDecoder);
    [index, bitIndex, extraBits] = this.readBits(buffer, index, bitIndex, magnitude);

    const dcCoeff = this.decodeMagnitudeAndBits(magnitude, extraBits) + prevDcCoeff;

    /* Now we start finding the 63 AC coefficients for this block */
    const acCoefficients = [];
    while (acCoefficients.length < 63) {
      /* Read an 8-bit, huffman-coded value in which the high 4 bits are the number
       * of preceding zeros (i.e. run-length encoding for zeroes only) and the low
       * 4 bits are the magnitude of the following AC coefficient */
      var composite, precedingZeroes;
      [index, bitIndex, composite] = huffman.decodeOne(buffer, index, end, bitIndex, acDecoder);

      /* There are 2 special values we need to check for */
      if (composite == 0) {
        /* 0 means 'end of block'; fill the rest of the AC coefficients with zeroes */
        while (acCoefficients.length < 63)
          acCoefficients.push(0);
      } else if (composite == 0xF0) {
        /* 0xF0 means '16 consecutive zeroes' */
        for (var i = 0; i < 16; i++)
          acCoefficients.push(0);
      } else {
        /* Regular AC coefficient */
        precedingZeroes = composite >> 4;
        magnitude = composite & 0xF;
        [index, bitIndex, extraBits] = this.readBits(buffer, index, bitIndex, magnitude);
        const acCoeff = this.decodeMagnitudeAndBits(magnitude, extraBits);

        while (precedingZeroes-- > 0)
          acCoefficients.push(0);
        acCoefficients.push(acCoeff);
      }
    }

    return [index, bitIndex, dcCoeff, acCoefficients];
  }

  /* Read some number of consecutive bits out of `buffer`, starting from specified position */
  readBits(buffer, index, bitIndex, nBits) {
    var result = 0;

    /* Read some bits from the last part of a byte which was already partially consumed */
    if (bitIndex) {
      if (8 - bitIndex >= nBits) {
        result = (buffer[index] >> (8 - bitIndex - nBits)) & ((1 << nBits) - 1);
        bitIndex += nBits;
        if (bitIndex == 8) {
          index++;
          bitIndex = 0;
        }
        return [index, bitIndex, result];
      } else {
        result = buffer[index++] & ((1 << (8 - bitIndex)) - 1);
        nBits -= (8 - bitIndex);
        bitIndex = 0;
      }
    }

    /* Read some number of whole bytes */
    while (nBits >= 8) {
      result = (result << 8) + buffer[index++];
      nBits -= 8;
    }

    /* Then any bits we need from the first part of the subsequent byte */
    if (nBits) {
      result = (result << nBits) + (buffer[index] >> (8 - nBits));
      bitIndex = nBits;
    }

    return [index, bitIndex, result];
  }

  /* This type of encoding is used for DC and AC coefficients */
  decodeMagnitudeAndBits(magnitude, bits) {
    const power = 1 << (magnitude - 1);
    if (bits >= power) {
      return bits;
    } else {
      return bits - (power * 2) + 1;
    }
  }

  static zigzagSequence = [
    0, 7,
    15, 8, 1,
    2, 9, 16, 23,
    31, 24, 17, 10, 3,
    4, 11, 18, 25, 32, 39,
    47, 40, 33, 26, 19, 12, 5,
    6, 13, 20, 27, 34, 41, 48, 55,
    56, 49, 42, 35, 28, 21, 14,
    22, 29, 36, 43, 50, 57,
    58, 51, 44, 37, 30,
    38, 45, 52, 59,
    60, 53, 46,
    54, 61,
    62
  ];

  inverseZigzagOrder(samples) {
    if (samples.length != 63)
      throw new Error("Expected 63 AC coefficients");
    var permutation = new Array(63);
    for (var i = 0; i < 63; i++)
      permutation[JPEG.zigzagSequence[i]] = samples[i];
    return permutation;
  }

  /* Discrete cosine transform */

  inverseDCT(dcCoeff, acCoeff) {
    const samples = new Array(64).fill(0);
    const coefficients = acCoeff;
    coefficients.unshift(dcCoeff);

    for (var x = 0; x < 8; x++) {
      for (var y = 0; y < 8; y++) {
        var sample = 0;

        for (var u = 0; u < 8; u++) {
          const cu = (u == 0) ? (1 / Math.sqrt(2)) : 1;
          for (var v = 0; v < 8; v++) {
            const cv = (v == 0) ? (1 / Math.sqrt(2)) : 1;
            sample += cu * cv * coefficients[v*8 + u] *
              Math.cos(Math.PI * u * (2*x + 1) / 16) *
              Math.cos(Math.PI * v * (2*y + 1) / 16);
          }
        }

        samples[y*8 + x] = sample / 4;
      }
    }

    return samples;
  }

  /* Color space conversion */

  convertYCbCrtoRGB(raster, index, y, cb, cr) {
    /* Y-Cb-Cr conversion as defined in JFIF spec 1.02, page 4
     * Add 128 to each value to undo the 'level shift' which is applied as
     * the first step in JPEG encoding */
    const r = this.clampRGB(y + (cr * 1.402) + 128);
    const g = this.clampRGB(y - (0.34414 * cb) - (0.71414 * cr) + 128);
    const b = this.clampRGB(y + (cb * 1.772) + 128);
    raster[index] = r;
    raster[index+1] = g;
    raster[index+2] = b;
  }

  clampRGB(value) {
    return Math.round(Math.min(Math.max(value, 0), 255));
  }
}

module.exports.JPEG = JPEG;
