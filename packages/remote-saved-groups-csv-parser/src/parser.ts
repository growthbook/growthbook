import {
  MAX_ERRORS,
  MAX_ID_LENGTH,
  MAX_LINE_BYTES,
  NEWLINE,
} from "./constants";
import {
  BINARY_SIGNATURE_BYTES,
  checkLine,
  NOT_TEXT,
  startsLikeBinary,
} from "./lines";
import { RemoteGroupCsvOptions, RemoteGroupCsvResult } from "./types";

/**
 * Reads a remote saved group CSV in chunks, with memory bounded by one line.
 * Lines are split on newline bytes before decoding, since a newline never
 * occurs inside a multi-byte character. Any invalid line makes the file
 * invalid; reading continues so all invalid lines are counted, unless the file
 * isn't text at all.
 */
export class RemoteGroupCsvParser {
  private readonly options: RemoteGroupCsvOptions;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private partial: Uint8Array[] = [];
  private partialBytes = 0;
  private tooLong = false;
  private lineNumber = 0;
  private idCount = 0;
  private invalidLineCount = 0;
  private errors: string[] = [];
  private fatal: string | null = null;

  constructor(options: RemoteGroupCsvOptions) {
    this.options = options;
  }

  /**
   * Whether the file isn't text at all, so reading more is pointless. Invalid
   * lines don't stop it, so every one of them is counted.
   */
  get stopped(): boolean {
    return this.fatal !== null;
  }

  push(chunk: Uint8Array): void {
    if (this.fatal) return;
    this.checkSignature(chunk);
    if (this.fatal) return;
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0) {
        this.fatal = NOT_TEXT;
        return;
      }
      if (chunk[i] === NEWLINE) {
        this.append(chunk.subarray(start, i));
        this.finishLine();
        start = i + 1;
      }
    }
    this.append(chunk.subarray(start));
  }

  end(): RemoteGroupCsvResult {
    this.checkSignature(new Uint8Array());
    if (!this.fatal && (this.partialBytes > 0 || this.tooLong)) {
      this.finishLine();
    }
    if (this.fatal) {
      return { type: "invalid", invalidLineCount: 0, errors: [this.fatal] };
    }
    if (this.invalidLineCount > 0) {
      return {
        type: "invalid",
        invalidLineCount: this.invalidLineCount,
        errors: this.errors,
      };
    }
    if (this.idCount === 0) {
      return {
        type: "invalid",
        invalidLineCount: 0,
        errors: ["The file has no IDs"],
      };
    }
    return { type: "valid", idCount: this.idCount };
  }

  // The signature can be split across chunks, so its bytes are collected
  // until there are enough, or the file ends.
  private signature: number[] | null = [];

  private checkSignature(chunk: Uint8Array) {
    if (!this.signature) return;
    for (const byte of chunk) {
      if (this.signature.length >= BINARY_SIGNATURE_BYTES) break;
      this.signature.push(byte);
    }
    if (chunk.length && this.signature.length < BINARY_SIGNATURE_BYTES) return;
    // Never replaces an error found first, like a null byte in a short file.
    this.fatal ??= startsLikeBinary(Uint8Array.from(this.signature));
    this.signature = null;
  }

  private append(bytes: Uint8Array) {
    if (this.tooLong || !bytes.length) return;
    if (this.partialBytes + bytes.length > MAX_LINE_BYTES) {
      this.tooLong = true;
      this.partial = [];
      this.partialBytes = 0;
      return;
    }
    this.partial.push(bytes);
    this.partialBytes += bytes.length;
  }

  private finishLine() {
    const lineIndex = this.lineNumber++;
    const bytes = concat(this.partial, this.partialBytes);
    const tooLong = this.tooLong;
    this.partial = [];
    this.partialBytes = 0;
    this.tooLong = false;

    if (tooLong) {
      this.addError(lineIndex, `is longer than ${MAX_ID_LENGTH} characters`);
      return;
    }
    let line: string;
    try {
      line = this.decoder.decode(bytes);
    } catch {
      this.addError(lineIndex, "is not valid UTF-8 text");
      return;
    }
    const result = checkLine(line, this.options, lineIndex === 0);
    if ("error" in result) {
      this.addError(lineIndex, result.error);
    } else if ("id" in result) {
      this.idCount++;
      this.options.onId?.(result.id);
    }
  }

  private addError(lineIndex: number, problem: string) {
    this.invalidLineCount++;
    if (this.errors.length < MAX_ERRORS) {
      this.errors.push(`Line ${lineIndex + 1} ${problem}`);
    }
  }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Reads a whole CSV from a stream of byte chunks, such as a file or response body. */
export async function parseRemoteGroupCsv(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: RemoteGroupCsvOptions,
): Promise<RemoteGroupCsvResult> {
  const parser = new RemoteGroupCsvParser(options);
  for await (const chunk of chunks) {
    parser.push(chunk);
    // Leaving the loop closes the stream, so nothing more is downloaded.
    if (parser.stopped) break;
  }
  return parser.end();
}
