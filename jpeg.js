'use strict';

const huffman = require('./huffman.js');
const arithmetic = require('./arithmetic.js');
const exif = require('./exif.js');

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
    [0xCC, 'Define Arithmetic Coding Conditioning Tables'],
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
    [0xE2, 'Application-Specific (ICC color profile)'],
    [0xEE, 'Application-Specific (Adobe color encoding)'],
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
      i = buffer.indexOf(0xFF, i+1); /* Scan for marker */
      if (i == -1)
        break; /* Reached the end */

      const marker = buffer[i+1];
      if (marker === 0xFF || marker === 0) {
        i++;
        continue;
      }

      switch (marker) {
        case 0xC0: case 0xC1: case 0xC2: case 0xC3:
        case 0xC5: case 0xC6: case 0xC7: case 0xC8:
        case 0xC9: case 0xCA: case 0xCB: case 0xCD:
        case 0xCE: case 0xCF:
          jpg.handleFrameHeader(buffer, i);
          jpg.initCoefficientsArray();
          break;

        case 0xC4:
          /* TODO: skip over */
          jpg.handleHuffmanSegment(buffer, i);
          break;

        case 0xCC:
          /* TODO: skip over */
          jpg.handleConditioningSegment(buffer, i);
          break;

        case 0xD8: /* Start of Image */
          jpg.restartInterval = 0;
          break;

        case 0xDA:
          if (jpg.frameData.progressive) {
            jpg.readProgressiveScan(buffer, i);
          } else {
            jpg.readBaselineScan(buffer, i);
          }
          break;

        case 0xDB:
          i = jpg.handleQuantizationSegment(buffer, i) - 1;
          break;

        case 0xDD:
          jpg.handleRestartInterval(buffer, i);
          break;
      }
    }

    /* Now convert all coefficient blocks to natural (rather than zig-zag) order */
    for (const component of jpg.frameData.components) {
      const coeffs = jpg.coefficients[component.id-1];
      for (const coeffRow of coeffs) {
        for (const coeffBlock of coeffRow) {
          const quantTable = jpg.quantTables[component.quantTable].values;
          /* Overwrite block with dequantized and reordered coefficients */
          coeffBlock.splice(0, 64, ...jpg.inverseZigzagOrder(jpg.dequantizeCoefficients(coeffBlock, quantTable)));
        }
      }
    }

    /* Assemble blocks of coefficients from each component into interleaved MCU-size groups,
     * use the inverse DCT to convert to color samples, and enter these samples in the raster */
    const raster = Buffer.alloc(3 * jpg.frameData.width * jpg.frameData.height);
    const dummyBlock = new Array(64).fill(0);
    for (var mcuNumber = 0; mcuNumber < jpg.totalMcus; mcuNumber++) {
      const mcuRow = Math.floor(mcuNumber / jpg.mcusPerRow);
      const mcuCol = mcuNumber % jpg.mcusPerRow;
      const mcu    = [];

      for (const component of jpg.frameData.components) {
        const coeffs = jpg.coefficients[component.id-1];
        for (var blockRow = 0; blockRow < component.vertSampling; blockRow++) {
          for (var blockCol = 0; blockCol < component.horizSampling; blockCol++) {
            const row = coeffs[(mcuRow * component.vertSampling) + blockRow];
            if (!row) {
              mcu.push(dummyBlock);
            } else {
              const block = row[(mcuCol * component.horizSampling) + blockCol];
              mcu.push((block && jpg.inverseDCT(block)) || dummyBlock);
            }
          }
        }
      }

      jpg.paintPixels(raster, mcu, jpg.frameData.components, mcuNumber);
    }

    return [jpg, raster];
  }

  constructor() {
    this.dcTables = [];
    this.acTables = [];
    this.dcDecoders = []; /* For Huffman-coded images */
    this.acDecoders = [];
    this.dcStats = []; /* For arithmetic-coded images */
    this.acStats = [];
    this.quantTables = [];
    this.coefficients = [];
    this.frameData = undefined;
    this.maxHorizSampling = undefined;
    this.maxVertSampling = undefined;
    this.mcuPixelWidth = undefined; /* For interleaved scans */
    this.mcuPixelHeight = undefined;
    this.totalMcus = undefined;
    this.mcusPerRow = undefined;
    this.restartInterval = 0;
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

  readExifHeader(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFE1)
      throw new Error("Invalid EXIF header (wrong marker)");
    if (buffer.toString('binary', index+4, index+8) !== 'Exif')
      return [];
    const tiffHeader = index+10;

    /* ASCII 'II' means little-endian (for 'Intel'), 'MM' means big-endian (for 'Motorola') */
    const endiannessTag = buffer.toString('binary', tiffHeader, tiffHeader+2);
    var readInt16, readInt32, readUInt16, readUInt32, readFloat32, readFloat64;
    if (endiannessTag === 'II') {
      readInt16   = buffer.readInt16LE.bind(buffer);
      readInt32   = buffer.readInt32LE.bind(buffer);
      readUInt16  = buffer.readUInt16LE.bind(buffer);
      readUInt32  = buffer.readUInt32LE.bind(buffer);
      readFloat32 = buffer.readFloatLE.bind(buffer);
      readFloat64 = buffer.readDoubleLE.bind(buffer);
    } else if (endiannessTag === 'MM') {
      readInt16   = buffer.readInt16BE.bind(buffer);
      readInt32   = buffer.readInt32BE.bind(buffer);
      readUInt16  = buffer.readUInt16BE.bind(buffer);
      readUInt32  = buffer.readUInt32BE.bind(buffer);
      readFloat32 = buffer.readFloatBE.bind(buffer);
      readFloat64 = buffer.readDoubleBE.bind(buffer);
    } else {
      throw new Error("Could not determine endianness of values in EXIF header");
    }
    const readInt8 = buffer.readInt8.bind(buffer), readUInt8 = buffer.readUInt8.bind(buffer);

    /* Get offset to first IFD or Image File Directory entry */
    var index = tiffHeader + readUInt32(tiffHeader+4);

    const images = [];
    while (index !== tiffHeader) {
      var nEntries = readUInt16(index);
      index += 2;

      const imageData = [];
      while (nEntries-- > 0) {
        const tagNumber   = readUInt16(index);
        const dataFormat  = readUInt16(index+2);
        /* Size of a single data 'component'; must be multiplied by number of 'components' */
        const dataSize    = [undefined, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][dataFormat];
        const nComponents = readUInt32(index+4);
        const dataOffset  = (dataSize * nComponents > 4) ? tiffHeader + readUInt32(index+8) : index+8;
        const dataReadFn  = [undefined,
          readUInt8, readUInt8, readUInt16, readUInt32, this.readRational(readUInt32),
          readInt8,  readUInt8, readInt16,  readInt32,  this.readRational(readInt32),
          readFloat32, readFloat64][dataFormat];

        var value = this.readExifValue(dataOffset, dataSize, nComponents, dataReadFn);
        if (dataFormat === 2) {
          value = (nComponents > 1) ? String.fromCharCode(...value) : String.fromCharCode(value);
        } else if (exif.lookupTables.has(tagNumber)) {
          if (nComponents === 1)
            value = exif.lookupTables.get(tagNumber).get(value) || value;
          else
            value = value.map((n) => exif.lookupTables.get(tagNumber).get(n) || n);
        }
        imageData.push([tagNumber, exif.tags.get(tagNumber), value]);
        index += 12;
      }
      images.push(imageData);
      index = tiffHeader + readInt32(index);
    }

    return images;
  }

  readExifValue(offset, size, n, readFn) {
    if (n == 1)
      return readFn(offset);

    const result = [];
    while (n-- > 0) {
      result.push(readFn(offset));
      offset += size;
    }
    return result;
  }

  readRational(readValueFn) {
    return function(offset) {
      return [readValueFn(offset), readValueFn(offset+4)];
    }
  }

  dumpExifHeader(buffer, index) {
    console.group();
    console.dir(this.readExifHeader(buffer, index), {depth: null});
    console.groupEnd();
  }

  readICCColorProfile(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFE2)
      throw new Error("Invalid ICC color profile (wrong marker)");
    if (buffer.toString('binary', index+4, index+15) !== 'ICC_PROFILE')
      return {};

    const length  = buffer.readUInt16BE(index+2);

    /* ICC.1:2010 section B.4 says that an ICC color profile embedded in a JPEG
     * file should have a 1-byte 'chunk number' immediately following the identifier.
     * This is intended for cases where color profile data is split over multiple
     * sections of the JPEG file.
     *
     * However, ITU-T T.872 section 6.5.2 does not say that a 'chunk number' should
     * be used in such cases; rather, it says that the contents of all ICC color
     * profile sections should automatically be concatenated together.
     *
     * I'm not sure which is actually followed in practice. */
    const chunkNo = buffer[index+16];
    const content = buffer.slice(index+17, index+length+2);

    return { chunk: chunkNo, data: content };
  }

  dumpICCColorProfile(buffer, index) {
    console.group();
    console.log(this.readICCColorProfile(buffer, index));
    console.groupEnd();
  }

  readAdobeColorProfile(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFEE)
      throw new Error("Invalid Adobe color profile (wrong marker)");
    if (buffer.toString('binary', index+4, index+9) !== 'Adobe')
      return {};

    const transform = buffer[index+11];
    if (transform > 2)
      throw new Error("Invalid color transform specified in Adobe color profile");
    return { color: ['CMYK/RGB', 'YCbCr', 'YCCK'][transform] };
  }

  dumpAdobeColorProfile(buffer, index) {
    console.group();
    console.log(this.readAdobeColorProfile(buffer, index));
    console.groupEnd();
  }

  /* Start of Frame */

  readFrameHeader(buffer, index) {
    const marker       = buffer[index+1];
    const lossless     = (marker == 0xC3 || marker == 0xC7 || marker == 0xCB);
    const extended     = (marker == 0xC1 || marker == 0xC9);
    const progressive  = (marker == 0xC2 || marker == 0xC6 || marker == 0xCA || marker == 0xCE);
    const arithmetic   = (marker >= 0xC9);
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
      const componentId = buffer[index];
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
      components[componentId-1] = { id: componentId, quantTable: quantTableIdx, horizSampling: horizSampling, vertSampling: vertSampling };
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
    this.maxHorizSampling = this.frameData.components.reduce((max,c) => Math.max(max, c.horizSampling), 0);
    this.maxVertSampling = this.frameData.components.reduce((max,c) => Math.max(max, c.vertSampling), 0);

    /* For interleaved scans, which include blocks from all image components, each 'MCU' or group
     * of encoded blocks will cover this much of the image: */
    this.mcuPixelWidth = 8 * this.maxHorizSampling;
    this.mcuPixelHeight = 8 * this.maxVertSampling;

    /* How many MCUs will it take to complete the whole image (if interleaved scans are used)? */
    this.mcusPerRow = Math.ceil(this.frameData.width / this.mcuPixelWidth);
    this.totalMcus = this.mcusPerRow * Math.ceil(this.frameData.height / this.mcuPixelHeight);

    /* For non-interleaved scans, one block is counted as one 'MCU' and additional blocks which
     * fall outside the bounds of the image are not included just to complete the required
     * number of blocks for each MCU.
     * For such scans, our interest is just in how much of the image is covered by one block
     * of samples for a specific image component. */
    for (const component of this.frameData.components) {
      component.blockPixelWidth  = 8 * (this.maxHorizSampling / component.horizSampling);
      component.blockPixelHeight = 8 * (this.maxVertSampling  / component.vertSampling);
      component.blocksPerRow = Math.ceil(this.frameData.width  / component.blockPixelWidth);
      component.blocksPerCol = Math.ceil(this.frameData.height / component.blockPixelHeight);
    }
  }

  dumpRestartInterval(buffer, index) {
    console.group();
    console.log(`Restart interval: ${buffer.readUInt16BE(index+4)} MCUs`);
    console.groupEnd();
  }

  handleRestartInterval(buffer, index) {
    this.restartInterval = buffer.readUInt16BE(index+4);
  }

  initCoefficientsArray() {
    /* `coefficients` is a 4-level nested array:
     *
     * `coefficients[ci]`            --> all coefficients for an image component
     * `coefficients[ci][ri]`        --> all coefficients for a row of blocks of a component
     * `coefficients[ci][ri][bi]`    --> all coefficients for a specific block
     * `coefficients[ci][ri][bi][k]` --> one coefficient at index K (which may be zig-zag or natural order) */
    this.coefficients = new Array(this.frameData.components.length);
    for (const component of this.frameData.components) {
      const blockRows = this.coefficients[component.id-1] = new Array(component.blocksPerCol);
      for (var i = 0; i < blockRows.length; i++) {
        const row = blockRows[i] = [];
        for (var j = 0; j < component.blocksPerRow; j++)
          row.push(new Array(64).fill(0));
      }
    }
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

    return { type: tableClass, number: tableNumber, codes: codes, start: index, end: nextValueIndex };
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

  /* Arithmetic Conditioning Tables
   * For JPEGs which use arithmetic coding to compress the DCT coefficients
   * (The vast majority of JPEG files use Huffman coding) */

  readConditioningTable(buffer, index) {
    /* 1 byte for table properties */
    const tableClass  = buffer[index] >> 4; /* 0 is DC, 1 is AC */
    const tableNumber = buffer[index] & 0xF;
    /* Arithmetic coding just requires one 6-bit value for each AC 'table' and
     * 2 4-bit values for each DC 'table'. Everything else that is needed is
     * built in to the arithmetic decoder and its state machine. */
    const value = buffer[index+1];
    if (tableClass === 0) {
      const low = value & 0xF;
      const high = value >> 4;
      if (low < 0 || low > 15 || high < 0 || high > 15)
        throw new Error(`Invalid threshold values for arithmetic-coded DC coefficient conditioning`);
      return { type: 0, number: tableNumber, lowThreshold: low === 0 ? 0 : 1 << (low - 1), highThreshold: 1 << high };
    } else {
      if (value < 0 || value > 63)
        throw new Error(`Invalid threshold value ${value} for arithmetic-coded AC coefficient conditioning`);
      return { type: tableClass, number: tableNumber, threshold: value };
    }
  }

  handleConditioningSegment(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFCC)
      throw new Error("Invalid arithmetic conditioning segment (wrong marker)");
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length + 2;

    index += 4;
    while (index < end) {
      const table = this.readConditioningTable(buffer, index);
      if (table.type) {
        this.acTables[table.number] = table;
        this.acStats[table.number] = new arithmetic.Statistics(245);
      } else {
        this.dcTables[table.number] = table;
        this.dcStats[table.number] = new arithmetic.Statistics(49);
      }
      index += 2;
    }
  }

  dumpConditioningSegment(buffer, index) {
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length + 2;

    index += 4;
    while (index < end) {
      const table = this.readConditioningTable(buffer, index);
      console.group();
      console.log(`Arithmetic conditioning table class: ${table.type ? 'AC' : 'DC'}, Number: ${table.number}`);
      if (table.type)
        console.log(`Kx: ${table.threshold}`);
      else
        console.log(`U: ${table.highThreshold} L: ${table.lowThreshold}`);
      console.groupEnd();
      index += 2;
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
      return { precision: 16, number: tableNumber, values: values, start: index, end: index + 129 };
    } else {
      const values = Array.from(buffer.slice(index+1, index+65));
      return { precision: 8, number: tableNumber, values: values, start: index, end: index + 65 };
    }
  }

  dumpQuantizationSegment(buffer, index) {
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length + 2;

    index += 4;
    while (index < end) {
      const table = this.readQuantizationTable(buffer, index);
      console.group();
      console.log(`Quantization table number: ${table.number}, Precision: ${table.precision}`);
      console.log(table.values);
      console.groupEnd();
      index = table.end;
    }

    return index;
  }

  handleQuantizationSegment(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFDB)
      throw new Error("Invalid quantization tables segment (wrong marker)");
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length + 2;

    index += 4;
    while (index < end) {
      const table = this.readQuantizationTable(buffer, index);
      this.quantTables[table.number] = table;
      index = table.end;
    }

    return index;
  }

  dequantizeCoefficients(coefficients, quantTable) {
    for (var i = 0; i < coefficients.length; i++)
      coefficients[i] *= quantTable[i];
    return coefficients;
  }

  /* Scan header */

  readScanHeader(buffer, index) {
    if (buffer.readUInt16BE(index) !== 0xFFDA)
      throw new Error("Invalid scan header (wrong marker)");
    const length = buffer.readUInt16BE(index+2);
    const end    = index + length;

    var nComponents = buffer[index+4];
    var components  = [];
    var result      = { components: components };

    index += 5;
    while (nComponents-- > 0) {
      const componentId = buffer[index];
      const componentData = this.frameData.components[componentId-1];
      components.push(Object.assign({ dcTable: buffer[index+1] >> 4, acTable: buffer[index+1] & 0xF }, componentData));
      index += 2;
    }

    if (index < end) {
      /* The remaining values in the scan header are only needed for progressive
       * or lossless JPEGs */
      const selectionStart = buffer[index];
      const selectionEnd   = buffer[index+1];
      const approxBitPos   = buffer[index+2];
      if (this.frameData.progressive) {
        result = {
          spectralStart: selectionStart,
          spectralEnd: selectionEnd,
          approxBitHigh: approxBitPos >> 4,
          approxBitLow: approxBitPos & 0xF,
          components: components
        };
      } else if (this.frameData.lossless) {
        result = {
          predictor: selectionEnd,      /* This field has different meaning for lossless JPEGs */
          pointTransform: approxBitPos, /* Likewise */
          components: components
        };
      } else if (selectionStart || (selectionEnd !== 63) || approxBitPos) {
        /* The last scan header fields should have fixed values for sequential DCT-based JPEGs */
        throw new Error("Unexpected values in scan header");
      }
    }

    return result;
  }

  dumpScanHeader(buffer, index) {
    console.group();
    console.log(this.readScanHeader(buffer, index));
    console.groupEnd();
  }

  readBaselineScan(buffer, index) {
    const header = this.readScanHeader(buffer, index);
    index += buffer.readUInt16BE(index+2) + 2; /* Go past end of scan header */

    /* ECS encodes a series of "MCUs" or "minimum coded units"
     *
     * Each MCU consists of (horizontalSamplingFactor * verticalSamplingFactor) 8x8 blocks
     * for component 1, then for component 2... up to the last component */
    var mcuNumber = 0;

    /* Decode any number of entropy-coded segments delimited by restart markers */
    while (true) {
      const [ecs, ecsEnd] = this.extractEntropyCodedSegment(buffer, index);
      /* If a restart interval has been defined, each ECS should contain the specified
       * number of MCUs. Otherwise, it should be enough MCUs to complete the image */
      const expectedMcus = this.restartInterval ? Math.min(this.restartInterval, this.totalMcus - mcuNumber) : this.totalMcus;

      /* Decode entropy-coded data in this ECS and update `coefficients` */
      if (this.frameData.coding === 'huffman') {
        this.readHuffmanCodedSegment(header, ecs, mcuNumber, mcuNumber + expectedMcus);
      } else {
        this.resetArithmeticStatisticsAreas();
        this.readArithmeticCodedSegment(header, ecs, mcuNumber, mcuNumber + expectedMcus);
      }
      mcuNumber += expectedMcus;

      if (buffer[ecsEnd+1] >= 0xD0 && buffer[ecsEnd+1] <= 0xD7) {
        /* Restart marker; continue decoding the scan data */
        index = ecsEnd+2;
      } else {
        break;
      }
    }
  }

  readProgressiveScan(buffer, index, coefficients) {
    const header = this.readScanHeader(buffer, index);
    const components = header.components;
    const interleaved = components.length > 1;

    index += buffer.readUInt16BE(index+2) + 2; /* Go past end of scan header */

    /* Unlike a baseline scan, which encodes all the data for an entire image,
     * each progressive scan carries only part of the image data. A progressive
     * scan may only encode some of the coefficients for each block of the image,
     * and it may not carry all the bits for each coefficient. Also, a progressive
     * scan may be for all image components, or for one component only. */
    const totalMcus = interleaved ? this.totalMcus : (components[0].blocksPerRow * components[0].blocksPerCol);
    var mcuNumber = 0;

    while (true) {
      const [ecs, ecsEnd] = this.extractEntropyCodedSegment(buffer, index);
      const expectedMcus = this.restartInterval ? Math.min(this.restartInterval, totalMcus - mcuNumber) : totalMcus;

      if (this.frameData.coding === 'huffman') {
        this.readProgressiveHuffmanCodedSegment(header, ecs, mcuNumber, mcuNumber + expectedMcus);
      } else {
        this.resetArithmeticStatisticsAreas();
        this.readProgressiveArithmeticCodedSegment(header, ecs, mcuNumber, mcuNumber + expectedMcus);
      }
      mcuNumber += expectedMcus;

      if (buffer[ecsEnd+1] >= 0xD0 && buffer[ecsEnd+1] <= 0xD7) {
        index = ecsEnd+2;
      } else {
        break;
      }
    }
  }

  extractEntropyCodedSegment(buffer, index) {
    /* Search for end of this entropy-coded segment */
    var ecsEnd = buffer.indexOf(0xFF, index);
    while (ecsEnd !== -1 && buffer[ecsEnd+1] == 0) /* byte stuffing */
      ecsEnd = buffer.indexOf(0xFF, ecsEnd+2);
    if (ecsEnd === -1)
      throw new Error("Unterminated scan section");

    /* Extract data for ECS and remove byte stuffing (convert 0xFF00 -> 0xFF) */
    var ecs = Buffer.allocUnsafe(ecsEnd - index);
    buffer.copy(ecs, 0, index, ecsEnd);
    return [this.removeByteStuffing(ecs), ecsEnd];
  }

  readHuffmanCodedSegment(header, ecs, nextMcu, lastMcu) {
    /* For each image component, we need to track the last DC coefficient seen within
     * the current scan; it is used to help calculate the next DC coefficient */
    const prevDcCoeffs = new Array(header.components.length).fill(0);
    const interleaved  = header.components.length > 1;

    /* Decode enough blocks to form a complete MCU
     * Then start again on the next MCU, until we reach the end of this ECS */
    var bytePos = 0, bitPos = 0, block;

    while (nextMcu < lastMcu && bytePos < ecs.length) {
      /* The scan header tells us which image components are present in this scan,
       * and in which order. Follow the specified order */
      for (var componentIndex = 0; componentIndex < header.components.length; componentIndex++) {
        const component  = header.components[componentIndex];
        const dcDecoder  = this.dcDecoders[component.dcTable];
        const acDecoder  = this.acDecoders[component.acTable];
        const coeffs     = this.coefficients[component.id-1];

        const horizBlocks = interleaved ? component.horizSampling : 1;
        const vertBlocks  = interleaved ? component.vertSampling  : 1;
        const rowIndex    = interleaved ? (Math.floor(nextMcu / this.mcusPerRow) * component.vertSampling) : Math.floor(nextMcu / component.blocksPerRow);
        const colIndex    = interleaved ? ((nextMcu % this.mcusPerRow) * component.horizSampling) : (nextMcu % component.blocksPerRow);

        for (var i = 0; i < vertBlocks; i++) {
          for (var j = 0; j < horizBlocks; j++) {
            const prevDcCoeff = prevDcCoeffs[componentIndex];
            [bytePos, bitPos, block] = this.readHuffmanSampleBlock(ecs, bytePos, bitPos, ecs.length, prevDcCoeff, dcDecoder, acDecoder);
            prevDcCoeffs[componentIndex] = block[0];

            if ((rowIndex + i) >= component.blocksPerCol || (colIndex + j) >= component.blocksPerRow) {
              /* This is a dummy block which falls outside the bounds of the image; it's only here to complete the
               * required number of blocks for each component within each MCU */
              continue;
            }
            coeffs[rowIndex + i][colIndex + j] = block;
          }
        }
      }
      nextMcu++;
    }
  }

  readArithmeticCodedSegment(header, ecs, nextMcu, lastMcu) {
    const prevDcCoeffs = new Array(header.components.length).fill(0);
    const prevDcDeltas = new Array(header.components.length).fill(0);
    const interleaved  = header.components.length > 1;
    const decoder      = new arithmetic.Decoder(Array.from(ecs));

    while (nextMcu < lastMcu) {
      for (var componentIndex = 0; componentIndex < header.components.length; componentIndex++) {
        const component  = header.components[componentIndex];
        /* JPEG spec defines default conditioning values in F.1.4.4.1.4 and F.1.4.4.2.1 */
        const dcTable    = this.dcTables[component.dcTable] || { lowThreshold: 0, highThreshold: 2 };
        const acTable    = this.acTables[component.acTable] || { threshold: 5 };
        const dcStats    = this.dcStats[component.dcTable];
        const acStats    = this.acStats[component.acTable];
        const coeffs     = this.coefficients[component.id-1];

        const horizBlocks = interleaved ? component.horizSampling : 1;
        const vertBlocks  = interleaved ? component.vertSampling  : 1;
        const rowIndex    = interleaved ? (Math.floor(nextMcu / this.mcusPerRow) * component.vertSampling) : Math.floor(nextMcu / component.blocksPerRow);
        const colIndex    = interleaved ? ((nextMcu % this.mcusPerRow) * component.horizSampling) : (nextMcu % component.blocksPerRow);

        for (var i = 0; i < vertBlocks; i++) {
          for (var j = 0; j < horizBlocks; j++) {
            const [prevDcCoeff, prevDcDelta] = [prevDcCoeffs[componentIndex], prevDcDeltas[componentIndex]];
            const [block, dcDelta] = this.readArithmeticSampleBlock(decoder, prevDcCoeff, prevDcDelta, dcTable, acTable, dcStats, acStats);
            prevDcCoeffs[componentIndex] = block[0];
            prevDcDeltas[componentIndex] = dcDelta;

            if ((rowIndex + i) >= component.blocksPerCol || (colIndex + j) >= component.blocksPerRow) {
              /* This is a dummy block which falls outside the bounds of the image; it's only here to complete the
               * required number of blocks for each component within each MCU */
              continue;
            }
            coeffs[rowIndex + i][colIndex + j] = block;
          }
        }
      }
      nextMcu++;
    }
  }

  readProgressiveHuffmanCodedSegment(header, ecs, nextMcu, lastMcu) {
    /* Which coefficients are encoded in this scan? And which bits for each coefficient? */
    const { components, spectralStart, spectralEnd, approxBitLow, approxBitHigh } = header;

    const prevDcCoeffs = (approxBitHigh === 0) && new Array(components.length).fill(0);
    const interleaved  = header.components.length > 1;

    var bytePos = 0, bitPos = 0, zeroBands = 0, band;
    while (nextMcu < lastMcu && bytePos < ecs.length) {
      for (var componentIndex = 0; componentIndex < components.length; componentIndex++) {
        const component  = components[componentIndex];
        const dcDecoder  = this.dcDecoders[component.dcTable];
        const acDecoder  = this.acDecoders[component.acTable];
        const coeffs     = this.coefficients[component.id-1];

        const horizBlocks = interleaved ? component.horizSampling : 1;
        const vertBlocks  = interleaved ? component.vertSampling  : 1;
        const rowIndex    = interleaved ? (Math.floor(nextMcu / this.mcusPerRow) * component.vertSampling) : Math.floor(nextMcu / component.blocksPerRow);
        const colIndex    = interleaved ? ((nextMcu % this.mcusPerRow) * component.horizSampling) : (nextMcu % component.blocksPerRow);

        for (var i = 0; i < vertBlocks; i++) {
          for (var j = 0; j < horizBlocks; j++) {
            const dummyBlock = ((rowIndex + i) >= component.blocksPerCol) || ((colIndex + j) >= component.blocksPerRow);
            const block = dummyBlock ? (new Array(64).fill(0)) : coeffs[rowIndex + i][colIndex + j];

            if (approxBitHigh === 0) {
              /* This is the first scan which provides approximate coefficients with
               * indices in `spectralStart`..`spectralEnd` for the current image component.
               * The manner of encoding these approximate coefficients is just like a baseline scan */
              if (zeroBands) {
                /* A previous band of coefficients had an 'end of band' marker indicating this band is filled with zeros
                 * Since we initialize all the blocks by filling with zeroes, we don't need to do anything */
                zeroBands--;
              } else {
                const prevDcCoeff = prevDcCoeffs[componentIndex];
                [bytePos, bitPos, band, zeroBands] = this.readHuffmanSampleBlock(ecs, bytePos, bitPos, ecs.length, prevDcCoeff, dcDecoder, acDecoder, spectralStart, spectralEnd);
                if (spectralStart === 0)
                  prevDcCoeffs[componentIndex] = band[0];
                if (block)
                  block.splice(spectralStart, band.length, ...band);
              }
            } else {
              /* This is a subsequent 'refinement' scan which provides more low-end bits for each
               * coefficient with index between `spectralStart` and `spectralEnd` */
              if (zeroBands) {
                /* No coefficients which are currently zero will become non-zero, but we still do
                 * need to add one 'refinement' low-order bit to each non-zero coefficient
                 * (Even though this is a so-called 'zero band') */
                [bytePos, bitPos] = this.readSuccessiveApproximationBits(block, spectralStart, spectralEnd + 1, false, ecs, bytePos, bitPos);
                zeroBands--;
              } else {
                [bytePos, bitPos, zeroBands] = this.refineApproximateHuffmanCoefficients(block, ecs, bytePos, bitPos, ecs.length, dcDecoder, acDecoder, spectralStart, spectralEnd);
              }
            }
          }
        }
      }
      nextMcu++;
    }
  }

  readProgressiveArithmeticCodedSegment(header, ecs, nextMcu, lastMcu) {
    const { components, spectralStart, spectralEnd, approxBitLow, approxBitHigh } = header;

    const prevDcCoeffs = (approxBitHigh === 0) && new Array(components.length).fill(0);
    const prevDcDeltas = (approxBitHigh === 0) && new Array(components.length).fill(0);
    const interleaved  = header.components.length > 1;
    const decoder      = new arithmetic.Decoder(Array.from(ecs));

    while (nextMcu < lastMcu) {
      for (var componentIndex = 0; componentIndex < components.length; componentIndex++) {
        const component = components[componentIndex];
        const dcTable   = this.dcTables[component.dcTable] || { lowThreshold: 0, highThreshold: 2 };
        const acTable   = this.acTables[component.acTable] || { threshold: 5 };
        const dcStats   = this.dcStats[component.dcTable];
        const acStats   = this.acStats[component.acTable];
        const coeffs    = this.coefficients[component.id-1];

        const horizBlocks = interleaved ? component.horizSampling : 1;
        const vertBlocks  = interleaved ? component.vertSampling  : 1;
        const rowIndex    = interleaved ? (Math.floor(nextMcu / this.mcusPerRow) * component.vertSampling) : Math.floor(nextMcu / component.blocksPerRow);
        const colIndex    = interleaved ? ((nextMcu % this.mcusPerRow) * component.horizSampling) : (nextMcu % component.blocksPerRow);

        for (var i = 0; i < vertBlocks; i++) {
          for (var j = 0; j < horizBlocks; j++) {
            const dummyBlock = ((rowIndex + i) >= component.blocksPerCol) || ((colIndex + j) >= component.blocksPerRow);
            const block = dummyBlock ? [] : coeffs[rowIndex + i][colIndex + j];

            if (approxBitHigh === 0) {
              /* This is the first progressive scan covering this range of coefficients;
               * Retrieve the high-order bits for each one */
              const [prevDcCoeff, prevDcDelta] = [prevDcCoeffs[componentIndex], prevDcDeltas[componentIndex]];
              const [band, dcDelta] = this.readArithmeticSampleBlock(decoder, prevDcCoeff, prevDcDelta, dcTable, acTable, dcStats, acStats, spectralStart, spectralEnd);
              if (spectralStart === 0) {
                prevDcCoeffs[componentIndex] = band[0];
                prevDcDeltas[componentIndex] = dcDelta;
              }
              if (block)
                block.splice(spectralStart, band.length, ...band);
            } else {
              /* Successive approximation; refine approximate coefficients by adding low-order bits
               * First add a low-order bit to the DC coefficient, if it is included in this scan */
              if (spectralStart === 0) {
                const [lowBit,] = decoder.decodeDecision(0x5A1D, false)
                block[0] = (block[0] << 1) | (lowBit ? 1 : 0);
              }

              /* Now add low-order bits to the AC coefficients in this scan */
              var trailingZeroIndex = spectralEnd;
              while (!block[trailingZeroIndex] && trailingZeroIndex >= spectralStart)
                trailingZeroIndex--;
              trailingZeroIndex++;

              for (var zigZagIndex = Math.max(spectralStart, 1); zigZagIndex <= spectralEnd; zigZagIndex++) {
                const SE = 3 * zigZagIndex;

                /* Are we at 'end of band'?
                 * EOB will always be at the same position _or later_ than it was on the previous progressive
                 * scan covering these coefficients, so for positions before that, no 'EOB?' bit is encoded
                 *
                 * Also, if we find a zero coefficient, check if it should be made non-zero, and find it
                 * should not, then we skip the 'EOB?' check on the next iteration, since EOB cannot occur
                 * immediately after a zero coefficient */
                if ((zigZagIndex === trailingZeroIndex || (zigZagIndex > trailingZeroIndex && block[zigZagIndex - 1] !== 0)) && decoder.decodeBit(acStats, SE)) {
                  /* We've reached end of band; the remaining bits are all zeroes */
                  while (zigZagIndex <= spectralEnd)
                    block[zigZagIndex++] <<= 1;
                  break;
                }

                if (block[zigZagIndex] !== 0) {
                  block[zigZagIndex] = (block[zigZagIndex] << 1) + (decoder.decodeBit(acStats, SE+2) ? (block[zigZagIndex] > 0 ? 1 : -1) : 0);
                } else if (decoder.decodeBit(acStats, SE+1)) {
                  /* This coefficient was zero in previous scans, but now we have reached its MSB
                   * Determine if it is positive or negative */
                  const [signBit,] = decoder.decodeDecision(0x5A1D, false);
                  block[zigZagIndex] = signBit ? -1 : 1;
                }
              }
            }
          }
        }
      }
      nextMcu++;
    }
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
  alignSamples(components, samples) {
    const result = new Array(components.length);

    var blockIndex = 0;
    for (var i = 0; i < components.length; i++) {
      const array = result[i] = new Array(this.mcuPixelWidth * this.mcuPixelHeight);
      const component = components[i];
      /* Iterate over blocks which carry data for this image component */
      for (var blockY = 0; blockY < component.vertSampling; blockY++) {
        for (var blockX = 0; blockX < component.horizSampling; blockX++) {
          const block  = samples[blockIndex++];
          const xScale = this.maxHorizSampling / component.horizSampling;
          const yScale = this.maxVertSampling  / component.vertSampling;
          for (var y = 0; y < 8 * yScale; y++) {
            for (var x = 0; x < 8 * xScale; x++) {
              array[(y + (blockY * 8 * yScale))*this.mcuPixelWidth + (x + (blockX * 8 * xScale))] = block[Math.floor(y / yScale)*8 + Math.floor(x / xScale)];
            }
          }
        }
      }
    }

    return result;
  }

  resetArithmeticStatisticsAreas() {
    for (var dcStats of this.dcStats)
      dcStats.reset();
    for (var acStats of this.acStats)
      acStats.reset();
  }

  /* Entropy coded segments */

  readHuffmanSampleBlock(buffer, index, bitIndex, end, prevDcCoeff, dcDecoder, acDecoder, spectralStart=0, spectralEnd=63) {
    /* For a baseline scan, read a 8x8 block of 64 coefficients
     * For a progressive scan, read only coefficients with indices from `spectralStart`..`spectralEnd`
     *
     * First is the DC coefficient for this block
     *
     * It is encoded as a 'magnitude category' (which is entropy-coded)
     * and some subsequent bits
     * The number of subsequent bits to read is equal to the numeric value of
     * the magnitude category
     * Category 0 is for value 0 only, category 1 is for -1 and 1, category 2
     * is for -3, -2, 2, and 3, etc...
     *
     * Further, it is offset by the value of the DC coefficient for the previous block */

    const coefficients = [];
    var magnitude, extraBits;
    if (spectralStart === 0) {
      [index, bitIndex, magnitude] = huffman.decodeOne(buffer, index, end, bitIndex, dcDecoder);
      [index, bitIndex, extraBits] = this.readBits(buffer, index, bitIndex, magnitude);
      const dcCoeff = this.decodeMagnitudeAndBits(magnitude, extraBits) + prevDcCoeff;
      coefficients.push(dcCoeff);
    }

    /* Now we start finding the AC coefficients for this block */
    const nCoefficients = spectralEnd - spectralStart + 1;
    while (coefficients.length < nCoefficients) {
      /* Read an 8-bit, huffman-coded value in which the high 4 bits are the number
       * of preceding zeros (i.e. run-length encoding for zeroes only) and the low
       * 4 bits are the magnitude of the following AC coefficient */
      var composite;
      [index, bitIndex, composite] = huffman.decodeOne(buffer, index, end, bitIndex, acDecoder);

      /* Check for special values */
      if (composite === 0) {
        /* 0 means 'end of block'; fill the rest of the AC coefficients with zeroes */
        while (coefficients.length < nCoefficients)
          coefficients.push(0);
      } else if (composite === 0xF0) {
        /* 0xF0 means '16 consecutive zeroes' */
        for (var i = 0; i < 16; i++)
          coefficients.push(0);
      } else if ((composite & 0xF) === 0) {
        /* For progressive scans only; this encodes a run of 'end of band' markers
         * It means that for some number of successive blocks, all the coefficients
         * between `spectralStart` and `spectralEnd` are zero */
        var zeroBands;
        [index, bitIndex, zeroBands] = this.readBits(buffer, index, bitIndex, composite >> 4);
        zeroBands += (1 << (composite >> 4)) - 1; /* Subtract one for the current band */
        while (coefficients.length < nCoefficients)
          coefficients.push(0);
        return [index, bitIndex, coefficients, zeroBands];
      } else {
        /* Regular AC coefficient */
        var precedingZeroes = composite >> 4;
        magnitude = composite & 0xF;
        [index, bitIndex, extraBits] = this.readBits(buffer, index, bitIndex, magnitude);
        const acCoeff = this.decodeMagnitudeAndBits(magnitude, extraBits);

        while (precedingZeroes-- > 0)
          coefficients.push(0);
        coefficients.push(acCoeff);
      }
    }

    return [index, bitIndex, coefficients];
  }

  readArithmeticSampleBlock(decoder, prevDcCoeff, prevDcDelta, dcTable, acTable, dcStats, acStats, spectralStart=0, spectralEnd=63) {
    var dcCoeff, dcDelta;
    if (spectralStart === 0) {
      dcDelta = decoder.decodeDCCoefficientDelta(dcStats, prevDcDelta, dcTable.lowThreshold, dcTable.highThreshold);
      dcCoeff = prevDcCoeff + dcDelta;
    }

    var coefficients;
    if (spectralEnd !== 0)
      coefficients = decoder.decodeACCoefficients(acStats, acTable.threshold, (spectralStart === 0) ? 1 : spectralStart, spectralEnd);
    else
      coefficients = [];

    if (spectralStart === 0) {
      coefficients.unshift(dcCoeff);
    }
    return [coefficients, dcDelta];
  }

  refineApproximateHuffmanCoefficients(coefficients, buffer, index, bitIndex, end, dcDecoder, acDecoder, spectralStart, spectralEnd) {
    var zigZagIndex = spectralStart;

    if (zigZagIndex === 0) {
      /* A different encoding is used for successive approximation of DC coefficients;
       * the added bits for each DC coefficient are simply concatenated, without any
       * compression or anything else special */
      var bit;
      [index, bitIndex, bit] = this.readBits(buffer, index, bitIndex, 1);
      coefficients[0] = (coefficients[0] << 1) | bit;
      zigZagIndex++;
    }

    while (zigZagIndex <= spectralEnd) {
      var composite;
      [index, bitIndex, composite] = huffman.decodeOne(buffer, index, end, bitIndex, acDecoder);

      if (composite === 0) {
        /* End of block */
        return this.readSuccessiveApproximationBits(coefficients, zigZagIndex, spectralEnd + 1, false, buffer, index, bitIndex);
      } else if ((composite & 0xF) === 0 && composite !== 0xF0) {
        var zeroBands;
        [index, bitIndex, zeroBands] = this.readBits(buffer, index, bitIndex, composite >> 4);
        zeroBands += (1 << (composite >> 4)) - 1; /* Subtract one for the current band */
        [index, bitIndex] = this.readSuccessiveApproximationBits(coefficients, zigZagIndex, spectralEnd + 1, false, buffer, index, bitIndex);
        return [index, bitIndex, zeroBands];
      } else if (composite === 0xF0) {
        /* Skip 16 zeroes, adding a successive approximation bit to each non-zero coefficient which
         * we pass along the way; don't add a new non-zero coefficient after the 16 zeroes */
        var skipPositions = 0;
        var skipZeroes = 16;
        while (zigZagIndex+skipPositions < spectralEnd) {
          if (coefficients[zigZagIndex + skipPositions] === 0) {
            skipZeroes--;
            if (skipZeroes === 0) {
              skipPositions++;
              break;
            }
          }
          skipPositions++;
        }
        [index, bitIndex] = this.readSuccessiveApproximationBits(coefficients, zigZagIndex, zigZagIndex + skipPositions, false, buffer, index, bitIndex);
        zigZagIndex += skipPositions;
      } else {
        /* Skip some number of zeroes, adding a successive approximation bit to each non-zero
         * coefficient which we pass along the way; then add a new non-zero coefficient in the
         * next zero position after that */
        if ((composite & 0xF) !== 1)
          throw new Error(`On successive approximation refinement scan, magnitude of encoded coefficients must be 1`);
        var skipZeroes = composite >> 4;
        var skipPositions = 0;
        while (zigZagIndex+skipPositions < spectralEnd) {
          if (coefficients[zigZagIndex + skipPositions] === 0) {
            if (skipZeroes === 0)
              break;
            skipZeroes--;
          }
          skipPositions++;
        }
        [index, bitIndex] = this.readSuccessiveApproximationBits(coefficients, zigZagIndex, zigZagIndex + skipPositions, true, buffer, index, bitIndex);
        zigZagIndex += skipPositions + 1;
      }
    }

    return [index, bitIndex];
  }

  /* For progressive scans which use successive approximation; read a series of bits
   * which need to be appended to the low-end of non-zero coefficients
   *
   * They may be preceded by a single bit which encodes a 1/-1 value for the last
   * coefficient in the range of interest */
  readSuccessiveApproximationBits(coefficients, start, end, readSignBit, buffer, index, bitIndex) {
    var bitsNeeded = readSignBit ? 1 : 0;
    for (var i = start; i < end; i++)
      if (coefficients[i] !== 0)
        bitsNeeded++;

    while (bitsNeeded > 0) {
      /* Bitwise arithmetic in JavaScript simply does not work on bitfields larger than 32 bits
       * (Even if we're running on a 64-bit CPU...) */
      const nBits = Math.min(bitsNeeded, 31);
      var bits;
      [index, bitIndex, bits] = this.readBits(buffer, index, bitIndex, nBits);
      bitsNeeded -= nBits;
      var mask = 1 << (nBits - 1);

      if (readSignBit) {
        coefficients[end] = ((bits & mask) !== 0) ? 1 : -1;
        mask >>= 1;
        readSignBit = false;
      }

      for (var i = start; i < end; i++) {
        if (coefficients[i] !== 0) {
          coefficients[i] = (coefficients[i] << 1) + (((bits & mask) !== 0) ? (coefficients[i] > 0 ? 1 : -1) : 0);
          mask >>= 1;
          if (!mask) {
            /* We have used up the 31 bits retrieved above; go around the `while` loop
             * again and get more data bits to refine the coefficient values */
            start = i + 1;
            break;
          }
        }
      }
    }

    return [index, bitIndex];
  }

  /* Read some number of consecutive bits out of `buffer`, starting from specified position */
  readBits(buffer, index, bitIndex, nBits) {
    if (nBits > 32)
      throw new Error("readBits can only return up to 32 bits at a time");
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
      result = (result << 8) | buffer[index++];
      nBits -= 8;
    }

    /* Then any bits we need from the first part of the subsequent byte */
    if (nBits) {
      result = (result << nBits) | (buffer[index] >> (8 - nBits));
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
    0,
    1, 8,
    16, 9, 2,
    3, 10, 17, 24,
    32, 25, 18, 11, 4,
    5, 12, 19, 26, 33, 40,
    48, 41, 34, 27, 20, 13, 6,
    7, 14, 21, 28, 35, 42, 49, 56,
    57, 50, 43, 36, 29, 22, 15,
    23, 30, 37, 44, 51, 58,
    59, 52, 45, 38, 31,
    39, 46, 53, 60,
    61, 54, 47,
    55, 62,
    63
  ];

  inverseZigzagOrder(coefficients) {
    if (coefficients.length != 64)
      throw new Error(`Expected 64 coefficients, got ${coefficients.length}`);
    var permutation = new Array(64);
    for (var i = 0; i < 64; i++)
      permutation[JPEG.zigzagSequence[i]] = coefficients[i];
    return permutation;
  }

  /* Discrete cosine transform */

  inverseDCT(coefficients) {
    const samples = new Array(64).fill(0);

    for (var x = 0; x < 8; x++) {
      for (var y = 0; y < 8; y++) {
        var sample = 0;

        for (var u = 0; u < 8; u++) {
          const cu = (u === 0) ? (1 / Math.sqrt(2)) : 1;
          for (var v = 0; v < 8; v++) {
            const cv = (v === 0) ? (1 / Math.sqrt(2)) : 1;
            var coefficient = coefficients[v*8 + u];
            if (coefficient === 0)
              continue;
            sample += cu * cv * coefficient *
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

  paintPixels(raster, samples, components, mcuNumber) {
    /* First figure out where in the raster these pixels are located */
    const xStart = (mcuNumber % Math.ceil(this.frameData.width / this.mcuPixelWidth)) * this.mcuPixelWidth;
    const yStart = Math.floor(mcuNumber / Math.ceil(this.frameData.width / this.mcuPixelWidth)) * this.mcuPixelHeight;
    const xEnd   = Math.min(xStart + this.mcuPixelWidth, this.frameData.width);
    const yEnd   = Math.min(yStart + this.mcuPixelHeight, this.frameData.height);

    if (components.length == 3) {
      if (this.maxHorizSampling == 1 && this.maxVertSampling == 1) {
        /* All image components have the same resolution */
        this.paintYCbCrPixels(raster, samples, 8, xStart, xEnd, yStart, yEnd);
      } else {
        /* Some image components have different resolution from others; we need to
         * 'align' the corresponding samples in each image component before performing
         * the color space conversion. This may, for example, require taking each sample
         * from a lower-resolution component and scaling it up to become a 2x2 square of
         * 4 identical samples.
         *
         * This is different from what libjpeg does. If, for example, one image component
         * is sampled at double the X and Y resolution of another, so 8x8 samples of the
         * low-resolution component must be matched to 16x16 samples of the high-resolution
         * component, libjpeg actually evaluates the IDCT at 16x16 points (for the low
         * resolution component only), even though the coefficients were originally derived
         * from 8x8 pixels. This is perhaps a smarter way to scale the 8x8 block up. */
        const alignedSamples = this.alignSamples(components, samples);
        this.paintYCbCrPixels(raster, alignedSamples, this.mcuPixelWidth, xStart, xEnd, yStart, yEnd);
      }
    } else if (components.length == 1) {
      /* Luminance-only (grayscale) color space */
      this.paintGrayscalePixels(raster, samples, xStart, xEnd, yStart, yEnd);
    } else {
      throw new Error("Unknown color space");
    }
  }

  paintGrayscalePixels(raster, samples, xStart, xEnd, yStart, yEnd) {
    for (var y = 0; y < yEnd - yStart; y++) {
      for (var x = 0; x < xEnd - xStart; x++) {
        const rasterIndex = (((y + yStart) * this.frameData.width) + x + xStart) * 3;
        /* No need for any fancy conversion; R, G, and B are all equal to Y */
        raster[rasterIndex] = raster[rasterIndex+1] = raster[rasterIndex+2] = samples[0][y*8 + x] + 128;
      }
    }
  }

  /* `lineWidth` may not be the same as `xEnd - xStart`;
   * If these samples extend past the right side of the image, there may be some unused samples
   * on the right side of each line of samples */
  paintYCbCrPixels(raster, samples, lineWidth, xStart, xEnd, yStart, yEnd) {
    for (var y = 0; y < yEnd - yStart; y++) {
      for (var x = 0; x < xEnd - xStart; x++) {
        const rasterIndex = (((y + yStart) * this.frameData.width) + x + xStart) * 3;
        this.convertYCbCrtoRGB(raster, rasterIndex, samples[0][y*lineWidth + x], samples[1][y*lineWidth + x], samples[2][y*lineWidth + x]);
      }
    }
  }

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
