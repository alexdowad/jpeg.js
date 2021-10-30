A pure-JavaScript JPEG decoder
==============================

...Because I was interested in how JPEG works, and also wanted to practice programming with Node.JS.

This JPEG decoder is believed to (mostly) work, but is *not* production-ready. No, you may not use it in your product. However, curious persons who want to know how JPEG works might find it interesting to read the code.

It includes a couple of fun little utilities:

* `jpeg-dump.js`: Dump out details on all the sections of a JPEG file, such as the quantization and Huffman tables.
* `jpeg-peek.js`: Display a preview of a JPEG file in a terminal, using ANSI color escapes.

While the license is extremely restrictive, anyone who wants to use this code for something should feel free to write the author and request an exception.
