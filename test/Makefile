all: random-jpeg decode-jpeg jpeg-coefficients

random-jpeg: random-jpeg.c
	gcc -o random-jpeg -Wl,-rpath /home/alex/Downloads/jpeg-9d/.libs random-jpeg.c /home/alex/Downloads/jpeg-9d/.libs/libjpeg.so
# to use system libjpeg:
#	gcc -o random-jpeg random-jpeg.c -ljpeg

decode-jpeg: decode-jpeg.c
	gcc -o decode-jpeg decode-jpeg.c -ljpeg

jpeg-coefficients: jpeg-coefficients.c
	gcc -o jpeg-coefficients jpeg-coefficients.c -ljpeg
