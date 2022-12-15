import crypto from "crypto";
import path from "path";
import fs from "fs";
import AWS from "aws-sdk";
import uniqid from "uniqid";
import { Storage, GetSignedUrlConfig } from "@google-cloud/storage";
import {
  JWT_SECRET,
  S3_BUCKET,
  S3_DOMAIN,
  S3_REGION,
  UPLOAD_METHOD,
  GCS_BUCKET_NAME,
  GCS_DOMAIN,
} from "../util/secrets";

let s3: AWS.S3;
function getS3(): AWS.S3 {
  if (!s3) {
    AWS.config.update({ region: S3_REGION });
    s3 = new AWS.S3({ signatureVersion: "v4" });
  }
  return s3;
}

export function getUploadsDir() {
  return path.join(__dirname, "..", "..", "uploads");
}

function getFileSignature(filePath: string) {
  return crypto.createHmac("sha256", JWT_SECRET).update(filePath).digest("hex");
}

export async function uploadFile(
  filePath: string,
  signature: string,
  contents: Buffer
) {
  // Make sure signature matches
  const comp = getFileSignature(filePath);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(comp))) {
    throw new Error("Invalid upload signature");
  }

  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }

  const rootDirectory = getUploadsDir();
  const fullPath = path.join(rootDirectory, filePath);

  // Prevent directory traversal
  if (fullPath.indexOf(rootDirectory) !== 0) {
    throw new Error(
      "Error: Path must not escape out of the 'uploads' directory."
    );
  }

  const dir = path.dirname(fullPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(fullPath, contents);
}

export async function getFileUploadURL(ext: string, pathPrefix: string) {
  const mimetypes: { [key: string]: string } = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "text/svg",
  };

  if (!mimetypes[ext.toLowerCase()]) {
    throw new Error(
      `Invalid image file type. Only ${Object.keys(mimetypes).join(
        ", "
      )} accepted.`
    );
  }

  const filename = uniqid("img_");
  const filePath = `${pathPrefix}${filename}.${ext}`;

  async function getSignedGoogleUrl() {
    const storage = new Storage();

    const options: GetSignedUrlConfig = {
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: mimetypes[ext],
    };

    const [url] = await storage
      .bucket(GCS_BUCKET_NAME)
      .file(filePath)
      .getSignedUrl(options);

    return url;
  }

  if (UPLOAD_METHOD === "s3") {
    const s3Params = {
      Bucket: S3_BUCKET,
      Key: filePath,
      ContentType: mimetypes[ext],
      ACL: "public-read",
    };

    const uploadURL = getS3().getSignedUrl("putObject", s3Params);

    return {
      uploadURL,
      fileURL: S3_DOMAIN + (S3_DOMAIN.endsWith("/") ? "" : "/") + filePath,
    };
  } else if (UPLOAD_METHOD === "google-cloud") {
    const uploadURL = await getSignedGoogleUrl();

    return {
      uploadURL,
      fileURL: GCS_DOMAIN + (GCS_DOMAIN.endsWith("/") ? "" : "/") + filePath,
    };
  } else {
    const fileURL = `/upload/${filePath}`;
    const uploadURL = `/upload?path=${filePath}&signature=${getFileSignature(
      filePath
    )}`;
    return {
      uploadURL,
      fileURL,
    };
  }
}
