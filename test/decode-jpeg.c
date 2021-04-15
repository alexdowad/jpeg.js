#include <stdio.h>
#include <stdlib.h>

#include <jpeglib.h>

/* Decode a JPEG file, print out the RGB color samples as a JSON array */

int main(int argc, char **argv)
{
  struct jpeg_decompress_struct cinfo;
  struct jpeg_error_mgr jerr;
  JSAMPROW row_pointer;

  if (argc < 2) {
    fprintf(stderr, "Usage: decode-jpeg <filename>\n");
    exit(1);
  }

  FILE *infile = fopen(argv[1], "rb");

  cinfo.err = jpeg_std_error(&jerr);
  jpeg_create_decompress(&cinfo);
  jpeg_stdio_src(&cinfo, infile);
  jpeg_read_header(&cinfo, TRUE);

  jpeg_start_decompress(&cinfo);

  row_pointer = (JSAMPROW)(malloc(cinfo.output_width * cinfo.num_components));

  printf("[");
  while (cinfo.output_scanline < cinfo.output_height) {
    jpeg_read_scanlines(&cinfo, &row_pointer, 1);
    for (int i = 0; i < cinfo.image_width * cinfo.num_components; i++) {
      printf("%u", (unsigned char)(row_pointer[i]));
      if (i+1 < cinfo.image_width * cinfo.num_components || cinfo.output_scanline < cinfo.output_height)
        printf(",");
    }
    if (cinfo.output_scanline < cinfo.output_height)
      printf("\n");
  }
  printf("]\n");

  jpeg_finish_decompress(&cinfo);
  jpeg_destroy_decompress(&cinfo);
  fclose(infile);

  return 0;
}
