'use strict'

/* From a table mapping bitstrings to a corresponding symbol,
 * build a state table for a state machine which can decode
 * Huffman-coded data 4 bits at a time
 *
 * `table` is like: { 'bitstring' => symbol, ... } */
function prepareDecoder(table) {
  /* First find which states our state machine should have, and number them */
  const prefixes = new Map(); /* prefix of a valid bitstring -> state # */
  prefixes.set('', 0);

  var stateNumber = 1;
  for (var key of table.keys()) {
    for (var i = 1; i < key.length; i++) {
      const prefix = key.slice(0, i);
      if (!prefixes.has(prefix))
        prefixes.set(prefix, stateNumber++);
    }
  }

  /* Now generate transition table for each state */
  const states = new Array(stateNumber + 3);
  prefixes.forEach(function(n, prefix) {
    /* 'emit' stores the symbol value(s) to recognize if we receive input X
     * while in state N
     * 'goto' is the next state to transition to if we receive input X
     * 'bitIndex' is the number of bits consumed from input X to recognize
     * the first symbol in `emit` */
    var state = states[n] = {
      number: n,
      prefix: prefix,
      emit: new Array(16),
      goto: new Array(16),
      bitIndex: new Array(16)
    };

    for (var i = 0; i < 16; i++) {
      const input = i.toString(2).padStart(4, '0');
      var bitstring = prefix + input;
      var emit = state.emit[i] = [];

      /* Search table of valid codes to see any which match a prefix of `bitstring` */
      buildEmit: while (true) {
        for (var code of table.keys()) {
          if (bitstring.startsWith(code)) {
            if (!emit.length) /* Is this the first item going into `emit`? */
              state.bitIndex[i] = code.length - prefix.length;
            emit.push(table.get(code));
            bitstring = bitstring.slice(code.length);
            continue buildEmit;
          }
        }
        break;
      }

      state.goto[i] = prefixes.get(bitstring);
      Object.freeze(state);
    }
  });

  /* At the end of the state array, add 3 special states for handling either
   * 3, 2, or 1 'extra' bits at the beginning of the coded input */
  for (var nBits = 1; nBits <= 3; nBits++) {
    var state = states[states.length - nBits] = {
      emit: new Array(16),
      goto: new Array(16),
      bitIndex: new Array(16)
    }

    for (var i = 0; i < 2 ** nBits; i++) {
      var input = i.toString(2).padStart(nBits, '0');
      var emit = state.emit[i] = [];

      buildEmit: while (true) {
        for (var code of table.keys()) {
          if (input.startsWith(code)) {
            if (!emit.length)
              state.bitIndex[i] = code.length;
            emit.push(table.get(code));
            input = input.slice(code.length);
            continue buildEmit;
          }
        }
        break;
      }

      state.goto[i] = prefixes.get(input);
      Object.freeze(state);
    }
  }

  Object.freeze(states);
  return states;
}

/* `start` is an inclusive index, `end` is an exclusive one */
function decodeBuffer(buffer, start, end, decoder) {
  var position = start;
  var result = [];
  var state = decoder[0];

  while (position < end) {
    var value = buffer[position];

    result.push(...state.emit[value >> 4]);
    var goto = state.goto[value >> 4];
    if (goto !== undefined) {
      state = decoder[goto];
    } else if (position < end-1) { /* The last byte may be padded */
      throw new Error("Invalid input to Huffman decoder");
    } else {
      return result;
    }

    result.push(...state.emit[value & 0xF]);
    var goto = state.goto[value & 0xF];
    if (goto !== undefined) {
      state = decoder[goto];
    } else if (position < end-1) { /* As above */
      throw new Error("Invalid input to Huffman decoder");
    } else {
      return result;
    }

    position++;
  }

  return result;
}

/* Only decode a single symbol from the input
 * As with `decodeBuffer`, [start,end) are indices into `buffer`
 * `bitIndex` is the bit which we should start decoding from in `buffer[start]`,
 * where the MSB is numbered as 0 and the LSB as 7
 * Returns an array of: [nextByteIndex, nextBitIndex, symbol] */
function decodeOne(buffer, start, end, bitIndex, decoder) {
  var position = start;
  var state = decoder[0];

  /* Any 'extra' bits (less than a full byte) to consume at beginning of coded input? */
  if (bitIndex && position < end) {
    var value = buffer[position];

    /* Optionally consume 1, 2, or 3 leading bits to leave a multiple of 4 bits */
    var nBits = 4 - (bitIndex & 3);
    if (nBits && nBits < 4) {
      state = decoder[decoder.length - nBits];
      var bits = (bitIndex < 4 ? value >> 4 : value) & ((1 << nBits) - 1);
      var emit = state.emit[bits];
      if (emit.length) {
        bitIndex = bitIndex + state.bitIndex[bits];
        if (bitIndex == 8)
          position++;
        return [position, bitIndex % 8, emit[0]];
      }
      var goto = state.goto[bits];
      if (goto !== undefined) {
        state = decoder[goto];
      } else if (position < end-1) { /* The last byte may be padded */
        throw new Error("Invalid input to Huffman decoder");
      } else {
        throw new Error("End of input (reached padding)");
      }
    }

    /* Then consume the remaining 4 bits if there are any */
    if (bitIndex <= 4) {
      var emit = state.emit[value & 0xF];
      if (emit.length) {
        bitIndex = 4 + state.bitIndex[value & 0xF];
        if (bitIndex == 8)
          position++;
        return [position, bitIndex % 8, emit[0]];
      }
      var goto = state.goto[value & 0xF];
      if (goto !== undefined) {
        state = decoder[goto];
      } else if (position < end-1) { /* See above */
        throw new Error("Invalid input to Huffman decoder");
      } else {
        throw new Error("End of input (reached padding)");
      }
    }

    position++;
  }

  /* Consume full bytes, looking for a valid coded symbol */
  while (position < end) {
    var value = buffer[position];

    var emit = state.emit[value >> 4];
    if (emit.length) {
      return [position, state.bitIndex[value >> 4], emit[0]];
    }
    var goto = state.goto[value >> 4];
    if (goto !== undefined) {
      state = decoder[goto];
    } else if (position < end-1) { /* See above */
      throw new Error("Invalid input to Huffman decoder");
    } else {
      throw new Error("End of input (reached padding)");
    }

    var emit = state.emit[value & 0xF];
    if (emit.length) {
      bitIndex = state.bitIndex[value & 0xF] + 4;
      if (bitIndex == 8)
        position++
      return [position, bitIndex % 8, emit[0]];
    }
    var goto = state.goto[value & 0xF];
    if (goto !== undefined) {
      state = decoder[goto];
    } else if (position < end-1) { /* See above */
      throw new Error("Invalid input to Huffman decoder");
    } else {
      throw new Error("End of input (reached padding)");
    }

    position++;
  }

  throw new Error("No more input");
}

module.exports.prepareDecoder = prepareDecoder;
module.exports.decodeBuffer   = decodeBuffer;
module.exports.decodeOne      = decodeOne;
