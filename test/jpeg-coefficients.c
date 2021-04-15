#include <stdio.h>
#include <stdlib.h>

#include <jpeglib.h>

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

  printf("[\n");

  jvirt_barray_ptr *coeffs_array = jpeg_read_coefficients(&cinfo);
  for (int ci = 0; ci < cinfo.num_components; ci++) {
    JBLOCKARRAY buffer;
    JCOEFPTR block;
    jpeg_component_info *comp = &cinfo.comp_info[ci];

    printf("  [\n");

    for (int y = 0; y < comp->height_in_blocks; y++) {
      buffer = (cinfo.mem->access_virt_barray)((j_common_ptr)&cinfo, coeffs_array[ci], y, (JDIMENSION)1, FALSE);
      for (int x = 0; x < comp->width_in_blocks; x++) {
        printf("    [");

        block = buffer[0][x];
        for (int i = 0; i < 64; i++) {
          printf("%d", block[i]);
          if (i+1 < 64)
            printf(", ");
        }

        printf("]");
        if (x+1 < comp->width_in_blocks || y+1 < comp->height_in_blocks)
          printf(",");
        printf("\n");
      }
    }

    printf("  ]");
    if (ci+1 < cinfo.num_components)
      printf(",");
    printf("\n");
  }

  printf("]\n");

  fclose(infile);

  return 0;
}
