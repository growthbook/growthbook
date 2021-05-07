import uniqid from "uniqid";
import AWS from "aws-sdk";
import { S3_BUCKET, S3_DOMAIN, S3_REGION } from "../util/secrets";

AWS.config.update({ region: S3_REGION });
const s3 = new AWS.S3();

export async function getFileUploadURL(ext: string, pathPrefix: string) {
  const mimetypes: { [key: string]: string } = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "text/svg",
  };

  if (!mimetypes[ext]) {
    throw new Error(
      `Invalid image file type. Only ${Object.keys(mimetypes).join(
        ", "
      )} accepted.`
    );
  }

  const filename = uniqid("img_");
  const s3Params = {
    Bucket: S3_BUCKET,
    Key: `${pathPrefix}${filename}.${ext}`,
    ContentType: mimetypes[ext],
    ACL: "public-read",
  };

  const uploadURL = s3.getSignedUrl("putObject", s3Params);

  return {
    uploadURL,
    fileURL: S3_DOMAIN + "/" + s3Params.Key,
  };
}
