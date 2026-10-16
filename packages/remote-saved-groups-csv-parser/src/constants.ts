/** The longest ID a remote saved group accepts, in characters. */
export const MAX_ID_LENGTH = 1024;

/** How many problems a result lists; the rest are only counted. */
export const MAX_ERRORS = 10;

// The most bytes one line can need: every character at 4 bytes, plus room for
// quotes and padding. A longer line is invalid, so the rest isn't buffered.
export const MAX_LINE_BYTES = MAX_ID_LENGTH * 4 + 1024;

export const NEWLINE = 0x0a;
