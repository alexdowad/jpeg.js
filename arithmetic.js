/* Arithmetic encoding; a super efficient way to pack bits real tight.
 *
 * Requires a separate method for estimating, before encoding each input bit,
 * what the probability of a 0 (or 1) appearing in that position is. Uses less
 * output bits for encoding 'more probable' input bit sequences. There is no
 * minimum number of output bits needed to encode a given number of input bits;
 * it all depends on the probabilities involved. Very probable input sequences
 * are represented by almost no output bits.
 *
 * Unlike Huffman coding, Arithmetic coding doesn't require that the
 * probabilities be powers of 2 (50%, 25%, etc.) to achieve peak efficiency.
 *
 * This encoder uses a state machine to estimate probabilities, adaptively
 * adjusting the estimates based on the input bits already seen. It keeps N copies
 * of the state machine, one for each different type of data which will appear
 * in the input. When encoding a bit, you need to provide a 'context index'
 * to tell the encoder which of those N types of input data it is. This means
 * that probability estimates which have adjusted to one type of input data will
 * not be 'trashed' by an interval of some other type of data.
 *
 * !! Read up before proceeding: https://en.wikipedia.org/wiki/Arithmetic_coding */

class ArithmeticCoder {
  constructor(nContexts) {
    /* Trailing bits for the low bound of the current probability interval
     *
     * As we proceed, we will gradually shift this value to the left to make
     * space for ever-smaller fractional probability values to be added in.
     *
     * We will also periodically extract bits 19-26 and push these to the
     * output. Otherwise, as we keep left-shifting the value, those bits
     * would 'fall off the high end' and be lost */
    this.intervalBase = 0;

    /* Trailing bits of (approximate) size of the current probability interval
     *
     * Fixed-point. 0x8000 initially represents 75%. Logically, then, the value
     * should not exceed 0xAAAA or 100%. However, the maximum (and starting) value
     * is actually 0x10000 (or 150%). No wonder we say this is an _approximate_
     * interval size!
     *
     * Again, logically, for each encoded bit, we should multiply this value
     * by the % probability of the sub-interval which was picked to find the
     * new interval size. However, that would take one multiply op per
     * encoded bit, which is too expensive. So we fudge it; since this value is
     * never very far from 100%, we don't do the multiply (and pretend we did).
     * Just replace it with the size of the chosen sub-interval instead.
     *
     * (Most of the probability calculations in this encoder are not
     * strictly correct. But as long as the decoder uses the exact _same_
     * rough calculations, the input bits can be recovered correctly. And
     * the model used to estimate probabilities for the next input bit is
     * rough anyways, so using strictly correct math for intermediate
     * calculations wouldn't make a huge difference.)
     *
     * With each encoded bit, the interval size gets smaller. When it goes
     * below 0x8000 or 75%, we scale both interval base and size up by 2 by
     * left-shifting, so each unit represents 1/2 the probability value which
     * it previously did. All the math still works out after both values are
     * scaled up, so we can just proceed as normal. How clever is that? */
    this.intervalSize = 0x10000;

    /* How many times we need to left-shift the interval base value before
     * extracting another byte of output data */
    this.neededBits = 11;

    /* Which boolean value do we believe is more likely to be encoded next? */
    this.moreProbableSymbol = false;

    /* Indexes into state table, which is used to estimate the probability
     * of getting the LPS next */
    this.states = new Array(nContexts).fill(0);

    this.output = [];
  }

  /* This state machine is defined by the JPEG spec (See T.81, Table D.3, page 60) */
  static stateTable = [
    {probability: 0x5A1D, nextLPS: 1,  nextMPS: 1, swapMPS: 1 },
    {probability: 0x2586, nextLPS: 14, nextMPS: 2, swapMPS: 0 },
    {probability: 0x1114, nextLPS: 16, nextMPS: 3, swapMPS: 0 },
    {probability: 0x080B, nextLPS: 18, nextMPS: 4, swapMPS: 0 },
    {probability: 0x03D8, nextLPS: 20, nextMPS: 5, swapMPS: 0 },
    {probability: 0x01DA, nextLPS: 23, nextMPS: 6, swapMPS: 0 },
    {probability: 0x00E5, nextLPS: 25, nextMPS: 7, swapMPS: 0 },
    {probability: 0x006F, nextLPS: 28, nextMPS: 8, swapMPS: 0 },
    {probability: 0x0036, nextLPS: 30, nextMPS: 9, swapMPS: 0 },
    {probability: 0x001A, nextLPS: 33, nextMPS: 10, swapMPS: 0 },
    {probability: 0x000D, nextLPS: 35, nextMPS: 11, swapMPS: 0 },
    {probability: 0x0006, nextLPS: 9, nextMPS: 12, swapMPS: 0 },
    {probability: 0x0003, nextLPS: 10, nextMPS: 13, swapMPS: 0 },
    {probability: 0x0001, nextLPS: 12, nextMPS: 13, swapMPS: 0 },
    {probability: 0x5A7F, nextLPS: 15, nextMPS: 15, swapMPS: 1 },
    {probability: 0x3F25, nextLPS: 36, nextMPS: 16, swapMPS: 0 },
    {probability: 0x2CF2, nextLPS: 38, nextMPS: 17, swapMPS: 0 },
    {probability: 0x207C, nextLPS: 39, nextMPS: 18, swapMPS: 0 },
    {probability: 0x17B9, nextLPS: 40, nextMPS: 19, swapMPS: 0 },
    {probability: 0x1182, nextLPS: 42, nextMPS: 20, swapMPS: 0 },
    {probability: 0x0CEF, nextLPS: 43, nextMPS: 21, swapMPS: 0 },
    {probability: 0x09A1, nextLPS: 45, nextMPS: 22, swapMPS: 0 },
    {probability: 0x072F, nextLPS: 46, nextMPS: 23, swapMPS: 0 },
    {probability: 0x055C, nextLPS: 48, nextMPS: 24, swapMPS: 0 },
    {probability: 0x0406, nextLPS: 49, nextMPS: 25, swapMPS: 0 },
    {probability: 0x0303, nextLPS: 51, nextMPS: 26, swapMPS: 0 },
    {probability: 0x0240, nextLPS: 52, nextMPS: 27, swapMPS: 0 },
    {probability: 0x01B1, nextLPS: 54, nextMPS: 28, swapMPS: 0 },
    {probability: 0x0144, nextLPS: 56, nextMPS: 29, swapMPS: 0 },
    {probability: 0x00F5, nextLPS: 57, nextMPS: 30, swapMPS: 0 },
    {probability: 0x00B7, nextLPS: 59, nextMPS: 31, swapMPS: 0 },
    {probability: 0x008A, nextLPS: 60, nextMPS: 32, swapMPS: 0 },
    {probability: 0x0068, nextLPS: 62, nextMPS: 33, swapMPS: 0 },
    {probability: 0x004E, nextLPS: 63, nextMPS: 34, swapMPS: 0 },
    {probability: 0x003B, nextLPS: 32, nextMPS: 35, swapMPS: 0 },
    {probability: 0x002C, nextLPS: 33, nextMPS: 9, swapMPS: 0 },
    {probability: 0x5AE1, nextLPS: 37, nextMPS: 37, swapMPS: 1 },
    {probability: 0x484C, nextLPS: 64, nextMPS: 38, swapMPS: 0 },
    {probability: 0x3A0D, nextLPS: 65, nextMPS: 39, swapMPS: 0 },
    {probability: 0x2EF1, nextLPS: 67, nextMPS: 40, swapMPS: 0 },
    {probability: 0x261F, nextLPS: 68, nextMPS: 41, swapMPS: 0 },
    {probability: 0x1F33, nextLPS: 69, nextMPS: 42, swapMPS: 0 },
    {probability: 0x19A8, nextLPS: 70, nextMPS: 43, swapMPS: 0 },
    {probability: 0x1518, nextLPS: 72, nextMPS: 44, swapMPS: 0 },
    {probability: 0x1177, nextLPS: 73, nextMPS: 45, swapMPS: 0 },
    {probability: 0x0E78, nextLPS: 74, nextMPS: 46, swapMPS: 0 },
    {probability: 0x0BFB, nextLPS: 75, nextMPS: 47, swapMPS: 0 },
    {probability: 0x09F8, nextLPS: 77, nextMPS: 48, swapMPS: 0 },
    {probability: 0x0861, nextLPS: 78, nextMPS: 49, swapMPS: 0 },
    {probability: 0x0706, nextLPS: 79, nextMPS: 50, swapMPS: 0 },
    {probability: 0x05CD, nextLPS: 48, nextMPS: 51, swapMPS: 0 },
    {probability: 0x04DE, nextLPS: 50, nextMPS: 52, swapMPS: 0 },
    {probability: 0x040F, nextLPS: 50, nextMPS: 53, swapMPS: 0 },
    {probability: 0x0363, nextLPS: 51, nextMPS: 54, swapMPS: 0 },
    {probability: 0x02D4, nextLPS: 52, nextMPS: 55, swapMPS: 0 },
    {probability: 0x025C, nextLPS: 53, nextMPS: 56, swapMPS: 0 },
    {probability: 0x01F8, nextLPS: 54, nextMPS: 57, swapMPS: 0 },
    {probability: 0x01A4, nextLPS: 55, nextMPS: 58, swapMPS: 0 },
    {probability: 0x0160, nextLPS: 56, nextMPS: 59, swapMPS: 0 },
    {probability: 0x0125, nextLPS: 57, nextMPS: 60, swapMPS: 0 },
    {probability: 0x00F6, nextLPS: 58, nextMPS: 61, swapMPS: 0 },
    {probability: 0x00CB, nextLPS: 59, nextMPS: 62, swapMPS: 0 },
    {probability: 0x00AB, nextLPS: 61, nextMPS: 63, swapMPS: 0 },
    {probability: 0x008F, nextLPS: 61, nextMPS: 32, swapMPS: 0 },
    {probability: 0x5B12, nextLPS: 65, nextMPS: 65, swapMPS: 1 },
    {probability: 0x4D04, nextLPS: 80, nextMPS: 66, swapMPS: 0 },
    {probability: 0x412C, nextLPS: 81, nextMPS: 67, swapMPS: 0 },
    {probability: 0x37D8, nextLPS: 82, nextMPS: 68, swapMPS: 0 },
    {probability: 0x2FE8, nextLPS: 83, nextMPS: 69, swapMPS: 0 },
    {probability: 0x293C, nextLPS: 84, nextMPS: 70, swapMPS: 0 },
    {probability: 0x2379, nextLPS: 86, nextMPS: 71, swapMPS: 0 },
    {probability: 0x1EDF, nextLPS: 87, nextMPS: 72, swapMPS: 0 },
    {probability: 0x1AA9, nextLPS: 87, nextMPS: 73, swapMPS: 0 },
    {probability: 0x174E, nextLPS: 72, nextMPS: 74, swapMPS: 0 },
    {probability: 0x1424, nextLPS: 72, nextMPS: 75, swapMPS: 0 },
    {probability: 0x119C, nextLPS: 74, nextMPS: 76, swapMPS: 0 },
    {probability: 0x0F6B, nextLPS: 74, nextMPS: 77, swapMPS: 0 },
    {probability: 0x0D51, nextLPS: 75, nextMPS: 78, swapMPS: 0 },
    {probability: 0x0BB6, nextLPS: 77, nextMPS: 79, swapMPS: 0 },
    {probability: 0x0A40, nextLPS: 77, nextMPS: 48, swapMPS: 0 },
    {probability: 0x5832, nextLPS: 80, nextMPS: 81, swapMPS: 1 },
    {probability: 0x4D1C, nextLPS: 88, nextMPS: 82, swapMPS: 0 },
    {probability: 0x438E, nextLPS: 89, nextMPS: 83, swapMPS: 0 },
    {probability: 0x3BDD, nextLPS: 90, nextMPS: 84, swapMPS: 0 },
    {probability: 0x34EE, nextLPS: 91, nextMPS: 85, swapMPS: 0 },
    {probability: 0x2EAE, nextLPS: 92, nextMPS: 86, swapMPS: 0 },
    {probability: 0x299A, nextLPS: 93, nextMPS: 87, swapMPS: 0 },
    {probability: 0x2516, nextLPS: 86, nextMPS: 71, swapMPS: 0 },
    {probability: 0x5570, nextLPS: 88, nextMPS: 89, swapMPS: 1 },
    {probability: 0x4CA9, nextLPS: 95, nextMPS: 90, swapMPS: 0 },
    {probability: 0x44D9, nextLPS: 96, nextMPS: 91, swapMPS: 0 },
    {probability: 0x3E22, nextLPS: 97, nextMPS: 92, swapMPS: 0 },
    {probability: 0x3824, nextLPS: 99, nextMPS: 93, swapMPS: 0 },
    {probability: 0x32B4, nextLPS: 99, nextMPS: 94, swapMPS: 0 },
    {probability: 0x2E17, nextLPS: 93, nextMPS: 86, swapMPS: 0 },
    {probability: 0x56A8, nextLPS: 95, nextMPS: 96, swapMPS: 1 },
    {probability: 0x4F46, nextLPS: 101, nextMPS: 97, swapMPS: 0 },
    {probability: 0x47E5, nextLPS: 102, nextMPS: 98, swapMPS: 0 },
    {probability: 0x41CF, nextLPS: 103, nextMPS: 99, swapMPS: 0 },
    {probability: 0x3C3D, nextLPS: 104, nextMPS: 100, swapMPS: 0 },
    {probability: 0x375E, nextLPS: 99, nextMPS: 93, swapMPS: 0 },
    {probability: 0x5231, nextLPS: 105, nextMPS: 102, swapMPS: 0 },
    {probability: 0x4C0F, nextLPS: 106, nextMPS: 103, swapMPS: 0 },
    {probability: 0x4639, nextLPS: 107, nextMPS: 104, swapMPS: 0 },
    {probability: 0x415E, nextLPS: 103, nextMPS: 99, swapMPS: 0 },
    {probability: 0x5627, nextLPS: 105, nextMPS: 106, swapMPS: 1 },
    {probability: 0x50E7, nextLPS: 108, nextMPS: 107, swapMPS: 0 },
    {probability: 0x4B85, nextLPS: 109, nextMPS: 103, swapMPS: 0 },
    {probability: 0x5597, nextLPS: 110, nextMPS: 109, swapMPS: 0 },
    {probability: 0x504F, nextLPS: 111, nextMPS: 107, swapMPS: 0 },
    {probability: 0x5A10, nextLPS: 110, nextMPS: 111, swapMPS: 1 },
    {probability: 0x5522, nextLPS: 112, nextMPS: 109, swapMPS: 0 },
    {probability: 0x59EB, nextLPS: 112, nextMPS: 111, swapMPS: 1 },
  ];

  /* `bit` -> the bit to encode (as a boolean)
   * `context` -> zero-based integer, representing the type of input data which
   *              this bit represents (see comments at beginning of file) */
  encodeDecision(bit, context) {
    const state = ArithmeticCoder.stateTable[this.states[context]];

    /* `state.probability` is the estimated probability of getting the LPS
     * (In fixed-point representation, where 0x8000 means 75%. It should
     * always be less than 0x5555 or 50%.) */

    if (bit === this.moreProbableSymbol) {
      this.encodeMPS(state.probability, state, context);
    } else {
      this.encodeLPS(state.probability, state, context);
    }
  }

  /* Wrapper around `encodeDecision`.
   * Encode N low-order bits, starting from most significant end */
  encodeUInt(uint, nBits, context) {
    if (nBits < 0 || nBits > 32)
      throw new Error("An unsigned integer must have 0-32 bits");
    while (nBits--) {
      this.encodeDecision((uint & (1 << nBits)) !== 0, context);
    }
  }

  encodeMPS(probability, state, context) {
    /* Mathematically correct would be: (this.intervalSize * (1 - probability)),
     * along with a suitable right-shift to compensate for the use of fixed point
     * (See above comments about 'rough calculations') */
    this.intervalSize -= probability;

    /* Do we need to rescale interval size and base? */
    if (this.intervalSize < 0x8000) {
      /* Yes; but first check something else... */
      if (this.intervalSize < probability) {
        /* Normally the portion of the current probability interval closer to zero
         * means "the MPS occurred" (which is exactly what has happened; we're in
         * `encodeMPS`, after all). But in this case, we'll use the portion closer
         * to one to represent the MPS, meaning we need to adjust the interval base
         * upwards.
         *
         * If our algorithm did not include these swaps of sub-intervals, it would
         * still work, but would be a bit less efficient. */
        this.intervalBase += this.intervalSize;
        this.intervalSize = probability;
      }

      this.renormalize();
      this.states[context] = state.nextMPS;
    }
  }

  encodeLPS(probability, state, context) {
    if (this.intervalSize - probability < probability) {
      /* As above, swap sub-intervals so the one closer to zero represents the
       * LPS instead of the MPS. Since we are in `encodeLPS`, this means we don't
       * need to add anything to the interval base.
       *
       * Interval size must be less than 0xAAAA for the above condition to be
       * true, and it's likely closer to its minimum value of 0x8000. Under such
       * conditions, the following assignment approximates the mathematically
       * correct value. */
       this.intervalSize -= probability;
    } else {
      /* This is the usual case. Use sub-interval closer to one to represent LPS. */
      this.intervalBase += this.intervalSize - probability;
      /* Mathematically correct would be: (this.intervalSize * probability)
       * (See above comments about 'rough calculations') */
      this.intervalSize = probability;
    }

    if (state.swapMPS) {
      /* Our state machine is telling us that the most likely bit to appear
       * next is the opposite of what we _thought_ was more likely this time.
       *
       * Note that we never toggle `moreProbableSymbol` as long as the same,
       * expected bit keeps appearing. Only when the state machine guesses
       * wrong, do we consider guessing differently next time. */
      this.moreProbableSymbol = !this.moreProbableSymbol;
    }

    this.renormalize();
    this.states[context] = state.nextLPS;
  }

  renormalize() {
    /* See description of these values in the constructor */
    while (this.intervalSize < 0x8000) {
      this.intervalSize <<= 1;
      this.intervalBase <<= 1;
      this.neededBits--;

      if (this.neededBits === 0) {
        this.emitOutputByte();
        this.neededBits = 8;
      }
    }
  }

  emitOutputByte() {
    var outputByte = this.intervalBase >>> 19; /* Includes a 9th carry bit */

    /* Is the carry bit set? */
    if (outputByte > 0xFF) {
      /* If the preceding output bytes were 0xFF, the carry bit will ripple
       * backwards until we find a byte which was less than 0xFF.
       * Since every 0xFF byte is followed by an extra zero, which is not data
       * but rather just a marker, we need to skip those zeroes */
      var precedingIndex = this.output.length-1;
      while (this.output[precedingIndex] === 0 && this.output[precedingIndex-1] === 0xFF) {
        /* The rippling carry will flip all bits in that 0xFF byte, making them
         * zero. And the extra zero byte following it will no longer be needed
         * as a marker.
         * We can achieve the same effect by just removing the 0xFF and leaving
         * the zero where it is. */
        this.output.splice(precedingIndex-1, 1);
        precedingIndex -= 2;
      }
      if (precedingIndex >= 0)
        this.output[precedingIndex]++;

      outputByte &= 0xFF; /* Clear carry bit */
    }

    if (outputByte === 0xFF) {
      /* In a JPEG entropy-coded segment, 0xFF bytes are always followed by an
       * extra zero byte, which indicates that the previous 0xFF was _not_ a
       * section marker (which 0xFF usually indicates in a JPEG file) */
      this.output.push(0xFF);
      this.output.push(0);
    } else {
      this.output.push(outputByte);
    }

    this.intervalBase &= 0x7FFFF; /* Zero out the bits just processed */
  }

  /* Send any encoded bits which are still in the pipeline to output and
   * return final compressed bytes */
  flush() {
    /* Remember that arithmetic encoding works by converting a sequence of input
     * bits to an estimated probability _interval_ of getting that input sequence.
     *
     * Since we are done now, pick the point in that interval which has the most
     * trailing zero bytes. We don't output trailing zero bytes, so this will
     * slightly decrease the size of the compressed output.
     *
     * Remember that 0x10000 >= `intervalSize` >= 0x8000. So we can always pick
     * a point where the last 15 bits are zero, and perhaps even more. */
    const intervalTop = this.intervalBase + this.intervalSize - 1;
    var   chosenPoint = intervalTop & 0xFFFF0000;
    if (chosenPoint < this.intervalBase)
      chosenPoint += 0x8000;
    this.intervalBase = chosenPoint;

    /* We may have up to 11 bits of compressed data which must go to output */
    this.intervalBase <<= this.neededBits;
    this.emitOutputByte();
    this.intervalBase <<= 8;
    this.emitOutputByte();

    /* Strip trailing zeroes from output */
    while (this.output[this.output.length-1] === 0)
      this.output.pop();
    /* Add one back if we went too far and wiped out a 'marker' zero */
    if (this.output[this.output.length-1] === 0xFF)
      this.output.push(0);

    return this.output;
  }
}

/* Do the same stuff as `ArithmeticCoder`... backwards
 * See comments in `ArithmeticCoder` to understand the algorithm */
class ArithmeticDecoder {
  constructor(nContexts, input) {
    this.intervalBase = 0;
    this.intervalSize = 0x10000;
    this.neededBits = 0;
    this.moreProbableSymbol = false;
    this.states = new Array(nContexts).fill(0);
    this.input = input;

    /* Prime the pipeline */
    this.consumeInputByte();
    this.intervalBase <<= 8;
    this.consumeInputByte();
    this.intervalBase <<= 8;
  }

  decodeDecision(context) {
    var result;
    const state = ArithmeticCoder.stateTable[this.states[context]];

    this.intervalSize -= state.probability;

    if ((this.intervalBase >>> 16) < this.intervalSize) {
      if (this.intervalSize < 0x8000) {
        if (this.intervalSize < state.probability) {
          result = !this.moreProbableSymbol;
          if (state.swapMPS) {
            this.moreProbableSymbol = !this.moreProbableSymbol;
          }
          this.states[context] = state.nextLPS;
        } else {
          result = this.moreProbableSymbol;
          this.states[context] = state.nextMPS;
        }
      } else {
        return this.moreProbableSymbol;
      }
    } else {
      if (this.intervalSize < state.probability) {
        result = this.moreProbableSymbol;
        this.states[context] = state.nextMPS;
      } else {
        result = !this.moreProbableSymbol;
        if (state.swapMPS) {
          this.moreProbableSymbol = !this.moreProbableSymbol;
        }
        this.states[context] = state.nextLPS;
      }

      this.intervalBase -= (this.intervalSize << 16);
      this.intervalSize = state.probability;
    }

    this.renormalize();

    return result;
  }

  decodeUInt(nBits, context) {
    if (nBits < 0 || nBits > 32)
      throw new Error("An unsigned integer must have 0-32 bits");
    var uint = 0;
    while (nBits--) {
      if (this.decodeDecision(context))
        uint |= (1 << nBits);
    }
    return uint >>> 0; /* Convert to unsigned integer */
  }

  consumeInputByte() {
    if (this.input.length === 0) {
      /* We have reached the end of the input data
       * Act as if the input is padded with zeroes */
      return;
    }
    const inputByte = this.input.shift();

    if (inputByte === 0xFF) {
      const nextByte = this.input.shift();
      if (nextByte === 0) {
        this.intervalBase |= 0xFF00;
      } else {
        throw new Error("0xFF byte not properly stuffed");
      }
    } else {
      this.intervalBase += (inputByte << 8);
    }
  }

  renormalize() {
    do {
      if (this.neededBits === 0) {
        this.consumeInputByte();
        this.neededBits = 8;
      }

      this.intervalSize <<= 1;
      this.intervalBase <<= 1;
      this.neededBits--;
    } while (this.intervalSize < 0x8000);
  }
}

module.exports.ArithmeticCoder = ArithmeticCoder;
module.exports.ArithmeticDecoder = ArithmeticDecoder;
