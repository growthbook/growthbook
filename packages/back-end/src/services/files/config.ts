import {
  S3_BUCKET,
  S3_REGION,
  S3_DOMAIN,
  GCS_BUCKET_NAME,
  GCS_DOMAIN,
  VISUAL_EDITOR_ASSETS_S3_BUCKET,
  VISUAL_EDITOR_ASSETS_S3_REGION,
  VISUAL_EDITOR_ASSETS_S3_DOMAIN,
  VISUAL_EDITOR_ASSETS_GCS_BUCKET_NAME,
  VISUAL_EDITOR_ASSETS_GCS_DOMAIN,
} from "back-end/src/util/secrets";

// "private" is the existing bucket served via signed URLs.
// "visual-editor-assets" is the public, CDN-fronted bucket.
export type UploadDestination = "private" | "visual-editor-assets";

export interface DestinationConfig {
  s3Bucket: string;
  s3Region: string;
  s3Domain: string;
  gcsBucket: string;
  gcsDomain: string;
  // `undefined` means no Cache-Control header is set — private uploads
  // intentionally skip it so signed-URL responses aren't marked public
  // and replaceable files aren't pinned immutable.
  cacheControl: string | undefined;
}

export function getDestinationConfig(
  dest: UploadDestination,
): DestinationConfig {
  if (dest === "visual-editor-assets") {
    return {
      s3Bucket: VISUAL_EDITOR_ASSETS_S3_BUCKET,
      s3Region: VISUAL_EDITOR_ASSETS_S3_REGION,
      s3Domain: VISUAL_EDITOR_ASSETS_S3_DOMAIN,
      gcsBucket: VISUAL_EDITOR_ASSETS_GCS_BUCKET_NAME,
      gcsDomain: VISUAL_EDITOR_ASSETS_GCS_DOMAIN,
      // Files are UUID-keyed and never overwritten.
      cacheControl: "public, max-age=31536000, immutable",
    };
  }
  return {
    s3Bucket: S3_BUCKET,
    s3Region: S3_REGION,
    s3Domain: S3_DOMAIN,
    gcsBucket: GCS_BUCKET_NAME,
    gcsDomain: GCS_DOMAIN,
    cacheControl: undefined,
  };
}

/** A storage domain joined with a key, with exactly one slash between. */
export function joinUrl(domain: string, key: string): string {
  return domain + (domain.endsWith("/") ? "" : "/") + key;
}
