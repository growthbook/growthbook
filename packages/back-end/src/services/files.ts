import uniqid from "uniqid";
import AWS from "aws-sdk";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import {
  JWT_SECRET,
  S3_BUCKET,
  S3_DOMAIN,
  S3_REGION,
  UPLOAD_METHOD,
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

  const fullPath = getUploadsDir() + "/" + filePath;
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
  }
  // Otherwise, use the local file system
  else {
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
