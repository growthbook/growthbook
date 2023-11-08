import path from "path";
import fs from "fs";
import AWS from "aws-sdk";
import { Storage } from "@google-cloud/storage";
import {
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

export async function uploadFile(
  filePath: string,
  contentType: string,
  contents: Buffer
) {
  // Watch out for poison null bytes
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("Error: Filename must not contain null bytes");
  }
  let fileURL = "";

  if (UPLOAD_METHOD === "s3") {
    const params = {
      Bucket: S3_BUCKET,
      Key: filePath,
      Body: contents,
      ContentType: contentType,
    };
    await getS3().upload(params).promise();
    fileURL = S3_DOMAIN + (S3_DOMAIN.endsWith("/") ? "" : "/") + filePath;
  } else if (UPLOAD_METHOD === "google-cloud") {
    const storage = new Storage();

    await storage
      .bucket(GCS_BUCKET_NAME)
      .file(filePath)
      .save(contents, { contentType: contentType });

    fileURL = GCS_DOMAIN + (GCS_DOMAIN.endsWith("/") ? "" : "/") + filePath;
  } else {
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
    fileURL = `/upload/${filePath}`;
  }
  return fileURL;
}
