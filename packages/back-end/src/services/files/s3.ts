import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  S3_REGION,
  S3_ENDPOINT,
  AWS_ASSUME_ROLE,
} from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { joinUrl } from "./config";
import { FileStorage } from "./types";

/**
 * Builds an S3Client with optional role-assumption and custom-endpoint
 * support. Used to back the per-purpose client caches.
 */
export function buildS3Client({
  assumeRoleArn,
  roleSessionName,
  region,
}: {
  assumeRoleArn: string;
  roleSessionName: string;
  region?: string;
}): S3Client {
  const clientConfig: S3ClientConfig = {
    region: region ?? S3_REGION,
  };

  if (assumeRoleArn) {
    clientConfig.credentials = fromTemporaryCredentials({
      params: {
        RoleArn: assumeRoleArn,
        RoleSessionName: roleSessionName,
      },
    });
  }

  // Custom S3-compatible endpoint (MinIO for local dev, plus R2 / SeaweedFS
  // / etc. for self-hosted users). Path-style addressing is the safe default
  // for these providers; AWS S3 itself doesn't need it.
  if (S3_ENDPOINT) {
    clientConfig.endpoint = S3_ENDPOINT;
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
}

// One S3 client per region — the visual-editor-assets bucket can live
// in a different region from the private bucket.
const s3Clients = new Map<string, S3Client>();

function getS3Client(region: string): S3Client {
  let client = s3Clients.get(region);
  if (!client) {
    client = buildS3Client({
      assumeRoleArn: AWS_ASSUME_ROLE,
      roleSessionName: "growthbook-uploads",
      region,
    });
    s3Clients.set(region, client);
  }
  return client;
}

export async function s3GetObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
  range?: string,
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
  );
  if (!response.Body) throw new Error("Empty S3 response body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function s3ListByPrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const response = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  return (response.Contents ?? []).map((obj) => obj.Key ?? "").filter(Boolean);
}

export const s3FileStorage: FileStorage = {
  async upload(key, contentType, contents, cfg, logContext) {
    try {
      await getS3Client(cfg.s3Region).send(
        new PutObjectCommand({
          Bucket: cfg.s3Bucket,
          Key: key,
          Body: contents,
          ContentType: contentType,
          ...(cfg.cacheControl ? { CacheControl: cfg.cacheControl } : {}),
        }),
      );
    } catch (err) {
      // The API handler returns thrown errors to the client without
      // logging them, so without this the S3 push failing is invisible
      // server-side. Log enough to tell "which bucket/region/key" before
      // re-throwing so the original failure still surfaces to the caller.
      logger.error(
        {
          ...logContext,
          err,
          bucket: cfg.s3Bucket,
          region: cfg.s3Region,
          key,
          contentType,
          bytes: contents.length,
        },
        "[files] S3 PutObject failed",
      );
      throw err;
    }
    return joinUrl(cfg.s3Domain, key);
  },

  async getSize(key, cfg) {
    const head = await getS3Client(cfg.s3Region).send(
      new HeadObjectCommand({ Bucket: cfg.s3Bucket, Key: key }),
    );
    return head.ContentLength ?? 0;
  },

  async *readStream(key, cfg) {
    const response = await getS3Client(cfg.s3Region).send(
      new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: key }),
    );
    if (!response.Body) throw new Error("Empty S3 response body");
    yield* response.Body as AsyncIterable<Uint8Array>;
  },

  readRange(key, start, end, cfg) {
    return s3GetObjectBuffer(
      getS3Client(cfg.s3Region),
      cfg.s3Bucket,
      key,
      `bytes=${start}-${end}`,
    );
  },

  async delete(key, cfg) {
    await getS3Client(cfg.s3Region).send(
      new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: key }),
    );
  },

  getSignedReadUrl(key, expiresInMinutes, cfg) {
    return getSignedUrl(
      getS3Client(cfg.s3Region),
      new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: key }),
      { expiresIn: expiresInMinutes * 60 },
    );
  },

  async getSignedUploadUrl(
    {
      key,
      contentType,
      expiresInMinutes,
      contentDisposition,
      maxBytes,
      minBytes,
    },
    cfg,
  ) {
    // Cache-Control must appear as BOTH a Field and a Condition —
    // without the Condition S3 rejects with "extra input fields".
    const conditions: Array<
      ["eq", string, string] | ["content-length-range", number, number]
    > = [
      ["eq", "$Content-Type", contentType],
      ["eq", "$key", key],
    ];
    const fields: Record<string, string> = {
      key,
      "Content-Type": contentType,
    };
    if (cfg.cacheControl) {
      conditions.push(["eq", "$Cache-Control", cfg.cacheControl]);
      fields["Cache-Control"] = cfg.cacheControl;
    }
    if (contentDisposition) {
      conditions.push(["eq", "$Content-Disposition", contentDisposition]);
      fields["Content-Disposition"] = contentDisposition;
    }
    // content-length-range is the actual server-side size enforcement;
    // any client-side check is just UX.
    if (maxBytes && maxBytes > 0) {
      conditions.push(["content-length-range", minBytes, maxBytes]);
    }

    const { url, fields: signedFields } = await createPresignedPost(
      getS3Client(cfg.s3Region),
      {
        Bucket: cfg.s3Bucket,
        Key: key,
        Conditions: conditions,
        Fields: fields,
        Expires: expiresInMinutes * 60,
      },
    );

    return {
      signedUrl: url,
      fileUrl: joinUrl(cfg.s3Domain, key),
      fields: signedFields as Record<string, string>,
      cacheControl: cfg.cacheControl ?? null,
      contentDisposition,
      maxBytes: maxBytes ?? null,
    };
  },

  async copy(srcKey, destKey, cfg) {
    await getS3Client(cfg.s3Region).send(
      new CopyObjectCommand({
        Bucket: cfg.s3Bucket,
        CopySource: `${cfg.s3Bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
        Key: destKey,
      }),
    );
  },

  async promote(srcKey, destKey, cfg) {
    const client = getS3Client(cfg.s3Region);
    // FOOTGUN: MetadataDirective: REPLACE wipes Content-Type along with
    // everything else. Without re-supplying it the destination defaults
    // to `binary/octet-stream` (browsers download instead of render) and
    // gets pinned that way by our immutable cache headers. HEAD the
    // source first so we can echo its Content-Type onto the copy.
    const head = await client.send(
      new HeadObjectCommand({ Bucket: cfg.s3Bucket, Key: srcKey }),
    );
    await client.send(
      new CopyObjectCommand({
        Bucket: cfg.s3Bucket,
        // S3 CopySource is `<bucket>/<key>`, URI-encoded except `/`.
        CopySource: `${cfg.s3Bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
        Key: destKey,
        // REPLACE so the destination picks up our cache headers
        // (see Content-Type re-supply note above).
        MetadataDirective: "REPLACE",
        ...(head.ContentType ? { ContentType: head.ContentType } : {}),
        ...(cfg.cacheControl ? { CacheControl: cfg.cacheControl } : {}),
      }),
    );
    await client.send(
      new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: srcKey }),
    );
    return joinUrl(cfg.s3Domain, destKey);
  },

  async list(prefix, limit, cfg) {
    const result = await getS3Client(cfg.s3Region).send(
      new ListObjectsV2Command({
        Bucket: cfg.s3Bucket,
        Prefix: prefix,
        MaxKeys: limit,
      }),
    );
    return (result.Contents || [])
      .filter((obj): obj is { Key: string } & typeof obj => !!obj.Key)
      .map((obj) => ({
        key: obj.Key,
        url: joinUrl(cfg.s3Domain, obj.Key),
        size: obj.Size ?? 0,
        uploadedAt: obj.LastModified?.toISOString() ?? "",
      }));
  },
};
