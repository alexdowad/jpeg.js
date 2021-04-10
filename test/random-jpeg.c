#include <stdio.h>
#include <stdlib.h>
#include <time.h>

/* For system libjpeg: */
/* #include <jpeglib.h> */
#include "/home/alex/Downloads/jpeg-9d/jpeglib.h"

struct jpeg_compress_struct cinfo;
struct jpeg_error_mgr jerr;
FILE *outfile;
struct timespec ts; /* For seeding RNG */

/* Usage: random-jpeg <px width> <px height> <file> */

int main(int argc, char** argv)
{
  char *filename;
  int width, height;

  /* Process arguments */
  if (argc != 4) {
    fprintf(stderr, "Usage: random-jpeg <pixel width> <pixel height> <file>\n");
    exit(1);
  }

  width = atoi(argv[1]);
  height = atoi(argv[2]);
  filename = argv[3];

  if (width <= 0 || height <= 0) {
    fprintf(stderr, "Invalid pixel width or height\n");
    exit(1);
  }

  /* Seed RNG */
  clock_gettime(CLOCK_MONOTONIC, &ts);
  printf("RNG seed: %ld\n", ts.tv_nsec);
  srandom(ts.tv_nsec);

  /* Randomize the size of the image; the passed values will be the maximum */
  width = (random() % width) + 1;
  height = (random() % height) + 1;

  /* Open output file */
  if ((outfile = fopen(filename, "wb")) == NULL) {
    fprintf(stderr, "Can't open output file %s\n", filename);
    exit(1);
  }

  /* Initialize JPEG error manager */
  cinfo.err = jpeg_std_error(&jerr);
  /* Initialize JPEG compressor state */
  jpeg_create_compress(&cinfo);
  jpeg_stdio_dest(&cinfo, outfile);

  cinfo.image_width = width;
  cinfo.image_height = height;
  cinfo.input_components = 3;
  cinfo.in_color_space = JCS_RGB;
  jpeg_set_defaults(&cinfo);
  /* jpeg_set_colorspace(&cinfo, colorspace); */
  /* cinfo.dct_method = JDCT_ISLOW; */

  /* randomize quality, force_baseline: */
  jpeg_set_quality(&cinfo, random() % 100, random() & 1);
  /* randomize Huffman/arithmetic coding: */
  cinfo.arith_code = random() & 1;
  /* randomize whether to optimize Huffman tables: */
  cinfo.optimize_coding = random() & 1;
  /* randomize restart interval: */
  cinfo.restart_interval = random() % 8;
  /* randomize whether to use baseline or progressive compression: */
  if ((random() & 1) == 0) {
    /* TODO: We could even create randomized scan sequences (how many scans to use,
     * which spectral bits to include in each scan, etc) */
    jpeg_simple_progression(&cinfo);
  }
  /* randomize sampling ratios for all 3 components: */
  int max_h_sampling = (random() % 4) + 1; /* 1..4 */
  int max_v_sampling = (random() % 4) + 1; /* 1..4 */
  int blocks_per_mcu = 0;
  for (int i = 0; i < 3; i++) {
    /* Pick random values which divide evenly into the chosen 'max H' and 'max V' values
     *
     * For example, if the 'max' is 4, then 1, 2, or 4 can be chosen randomly.
     * If 'max' is 3, then only 1 or 3 can be chosen randomly.
     *
     * However, libjpeg expects that each MCU will have no more than 10 blocks of samples
     * in it. So the sum of HxV across all image components should not be more than 10. */
    int h_sampling = max_h_sampling >> (random() % (32 - __builtin_clz(max_h_sampling)));
    int v_sampling = max_v_sampling >> (random() % (32 - __builtin_clz(max_v_sampling)));
    if (blocks_per_mcu + (h_sampling * v_sampling) + (2 - i) > 10) {
      h_sampling = v_sampling = 1;
    }
    blocks_per_mcu += h_sampling * v_sampling;
    cinfo.comp_info[i].h_samp_factor = h_sampling;
    cinfo.comp_info[i].v_samp_factor = v_sampling;
  }

  jpeg_start_compress(&cinfo, TRUE);

  /* Allocate buffer for color samples */
  JSAMPLE  *samples = malloc(3 * width);
  if (samples == NULL) {
    fprintf(stderr, "Out of memory. Too bad.\n");
    exit(1);
  }
  JSAMPROW *row_pointer = &samples;

  /* Write random pixel data into compressor */
  while (height--) {
    for (int i = 0; i < width*3; i++) {
      samples[i] = random() % 256;
    }
    jpeg_write_scanlines(&cinfo, row_pointer, 1);
  }

  jpeg_finish_compress(&cinfo);
  jpeg_destroy_compress(&cinfo);
}
