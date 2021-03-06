'use strict';

const exifTags = new Map([
  [0x010E, 'Image Description'],
  [0x010F, 'Camera Maker'],
  [0x0110, 'Camera Model'],
  [0x0112, 'Orientation'],
  [0x011A, 'X Resolution'],
  [0x011B, 'Y Resolution'],
  [0x011C, 'Planar Configuration'],
  [0x0128, 'Resolution Unit'],
  [0x0131, 'Firmware Version'],
  [0x0132, 'Modification Date/Time'],
  [0x013E, 'White Point'],
  [0x013F, 'Primary Chromacity'],
  [0x0211, 'YCbCr Coefficients'],
  [0x0212, 'YCbCr Subsampling'],
  [0x0213, 'YCbCr Positioning'],
  [0x0214, 'Reference Black/White'],
  [0x8298, 'Copyright'],
  [0x8769, 'EXIF Offset'],
  [0x829A, 'Exposure Time'],
  [0x829D, 'F-Stop'],
  [0x8822, 'Exposure Program'],
  [0x8827, 'ISO Speed Rating'],
  [0x9000, 'EXIF Version'],
  [0x9003, 'Original Date/Time'],
  [0x9004, 'Digitization Date/Time'],
  [0x9101, 'Component Configuration'],
  [0x9102, 'Compression Ratio (bits/pixel)'],
  [0x9201, 'Shutter Speed'],
  [0x9202, 'Aperture'],
  [0x9203, 'Brightness'],
  [0x9204, 'Exposure Bias'],
  [0x9205, 'Maximum Aperture'],
  [0x9206, 'Subject Distance'],
  [0x9207, 'Metering Mode'],
  [0x9208, 'Light Source'],
  [0x9209, 'Flash used?'],
  [0x920A, 'Focal Length (mm)'],
  [0x927C, 'Maker Notes'],
  [0x9286, 'User Comment'],
  [0xA000, 'FlashPix Version'],
  [0xA001, 'Color Space'],
  [0xA002, 'Width'],
  [0xA003, 'Height'],
  [0xA004, 'Related Sound File'],
  [0xA005, 'EXIF Interoperability Offset'],
  [0xA20E, 'Focal Plane X Resolution'],
  [0xA20F, 'Focal Plane Y Resolution'],
  [0xA210, 'Focal Plane Resolution Unit'],
  [0xA217, 'Sensing Method'],
  [0xA300, 'File Source'],
  [0xA301, 'Scene Type'],
  [0x0100, 'Thumbnail Width'],
  [0x0101, 'Thumbnail Height'],
  [0x0102, 'Bits per Sample'],
  [0x0103, 'Thumbnail Compression Type'],
  [0x0106, 'Thumbnail Color Space'],
  [0x0111, 'Image Data Offset'],
  [0x0115, 'Samples per Pixel'],
  [0x0116, 'Rows'],
  [0x0117, 'Image Data Size'],
  [0x0201, 'JPEG Data Offset'],
  [0x0202, 'JPEG Data Size']]);

const orientationValues = new Map([
  [1, 'Upper Left'],
  [3, 'Lower Right'],
  [6, 'Upper Right'],
  [8, 'Lower Left']]);

const resolutionUnits = new Map([
  [1, 'No Unit'],
  [2, 'Pixels/inch'],
  [3, 'Pixels/cm']]);

const compressionTypes = new Map([
  [1, 'None'],
  [6, 'JPEG']]);

const exposurePrograms = new Map([
  [1, 'Manual Control'],
  [2, 'Normal Program'],
  [3, 'Aperture Priority'],
  [4, 'Shutter Priority'],
  [5, 'Slow Program'],
  [6, 'High-speed Program'],
  [7, 'Portrait Mode'],
  [8, 'Landscape Mode']]);

const meteringModes = new Map([
  [1, 'Average'],
  [2, 'Center-weighted Average'],
  [3, 'Spot'],
  [4, 'Multi-spot'],
  [5, 'Multi-segment']]);

const lightSources = new Map([
  [0, 'Auto'],
  [1, 'Daylight'],
  [2, 'Fluorescent'],
  [3, 'Tungsten'],
  [10, 'Flash']]);

const lookupTables = new Map([
  [0x0112, orientationValues],
  [0x0128, resolutionUnits],
  [0xA210, resolutionUnits],
  [0x0103, compressionTypes],
  [0x8822, exposurePrograms],
  [0x9207, meteringModes],
  [0x9208, lightSources]]);

module.exports.tags = exifTags;
module.exports.lookupTables = lookupTables;
