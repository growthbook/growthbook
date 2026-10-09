import { DestinationConfig } from "./config";

// Backend-agnostic listed file shape (S3 / GCS / local).
export interface ListedFile {
  key: string;
  url: string;
  size: number;
  // ISO 8601 timestamp; empty string if the backend can't supply one.
  uploadedAt: string;
}

export interface SignedUploadUrl {
  signedUrl: string;
  fileUrl: string;
  fields?: Record<string, string>;
  // The Cache-Control header the client must send with its PUT/POST.
  // `null` when no cache header is configured for this destination.
  cacheControl: string | null;
  // Content-Disposition the client must echo on the GCS PUT (S3 gets it as
  // a signed form field). `null` when none applies.
  contentDisposition: string | null;
  // Echoes the size cap so the client can do an early-error check.
  maxBytes: number | null;
}

export interface SignedUploadRequest {
  key: string;
  contentType: string;
  expiresInMinutes: number;
  contentDisposition: string | null;
  maxBytes?: number;
  minBytes: number;
}

/** One place files are stored: S3, Google Cloud Storage, or local disk. */
export interface FileStorage {
  /** Stores a file and returns its URL. */
  upload(
    key: string,
    contentType: string,
    contents: Buffer,
    cfg: DestinationConfig,
    logContext: Record<string, unknown>,
  ): Promise<string>;
  /** Throws when the file doesn't exist. */
  getSize(key: string, cfg: DestinationConfig): Promise<number>;
  readStream(key: string, cfg: DestinationConfig): AsyncIterable<Uint8Array>;
  /** Bytes `start` to `end`, inclusive. */
  readRange(
    key: string,
    start: number,
    end: number,
    cfg: DestinationConfig,
  ): Promise<Buffer>;
  /** Missing files are ignored. */
  delete(key: string, cfg: DestinationConfig): Promise<void>;
  getSignedReadUrl(
    key: string,
    expiresInMinutes: number,
    cfg: DestinationConfig,
  ): Promise<string>;
  getSignedUploadUrl(
    request: SignedUploadRequest,
    cfg: DestinationConfig,
  ): Promise<SignedUploadUrl>;
  /** Moves a file within a destination and returns its new URL. */
  promote(
    srcKey: string,
    destKey: string,
    cfg: DestinationConfig,
  ): Promise<string>;
  list(
    prefix: string,
    limit: number,
    cfg: DestinationConfig,
  ): Promise<ListedFile[]>;
}
