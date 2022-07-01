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
import { Storage } from "@google-cloud/storage";

let s3: AWS.S3;
function getS3(): AWS.S3 {
  if (!s3) {
    AWS.config.update({ region: S3_REGION });
    s3 = new AWS.S3({ signatureVersion: "v4" });
  }
  return s3;
}
// const projectId = "adept-arbor-354914"; // Get this from Google Cloud
// const keyFilename = "mytestkey.json"; // Get this from Google Cloud -> Credentials -> Service Accounts

// const storage = new Storage({
//   projectId,
//   keyFilename,
// });

// const googleCloudBucket = "gb_test_bucket_1"; // Get this from Google Cloud -> Storage

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // const filePath = `${pathPrefix}${filename}.${ext}`;
  const filePath =
    "/Users/michaelknowlton/growthbook/packages/back-end/stock-photo.jpeg";

  console.log("filePath", filePath);

  const projectId = "adept-arbor-354914"; // Get this from Google Cloud
  const keyFilename = "mytestkey.json"; // Get this from Google Cloud -> Credentials -> Service Accounts

  const storage = new Storage({
    projectId,
    keyFilename,
  });

  const googleCloudBucket = "gb_test_bucket_1"; // Get this from Google Cloud -> Storage

  async function uploadFile() {
    console.log("got into uploadFile method");
    const url = await storage.bucket(googleCloudBucket).upload(filePath, {
      destination: filename,
    });

    console.log("url", url[0].metadata.mediaLink);

    console.log(`${filePath} uploaded to ${googleCloudBucket}`);

    return url[0].metadata.mediaLink;
  }

  // async function generateSignedUrl() {
  //   console.log("got into the generatedSignedUrl method");
  //   // These options will allow temporary read access to the file
  //   const options: GetSignedUrlConfig = {
  //     version: "v4",
  //     action: "write",
  //     expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  //     contentType: "application/octet-stream",
  //   };

  //   // Get a v4 signed URL for uploading file
  //   const [url] = await storage
  //     .bucket(googleCloudBucket)
  //     .file(filename)
  //     .getSignedUrl(options);

  //   console.log(`The signed url for ${filename} is ${url}.`);

  //   return url;
  // }

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
    console.log("Hooray! We're using google-cloud"); //TODO: This didn't run for some reason

    // const uploadURL = generateSignedUrl();

    const uploadURL = await uploadFile().catch(console.error);
    const fileURL = uploadURL;

    console.log("uploadURL", uploadURL);

    // const fileURL = "test";

    return {
      uploadURL,
      fileURL,
    };

    // const uploadURL = "https://www.google.com";
    // const fileURL = "test";
    // try {
    //   // Need to convert the file to a blog
    //   const blob = googleCloudBucket.file(filename);
    //   console.log("blob was created", blob);
    //   // Need to create a blobStream
    //   const blobStream = blob.createWriteStream();
    //   console.log("blobStream was created", blobStream);
    //   // Need to watch for the finish of the blobStream to send back success
    //   blobStream.on("finish", () => {
    //     // res.status(200).send("Success");
    //     const uploadURL = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
    //     console.log("Success");
    //     return {
    //       uploadURL,
    //       fileURL,
    //     };
    //   });
    // } catch (error) {
    //   console.log(error);
    // }

    // Need to end blobStream
    // blobStream.end(req.file.buffer);
  } // Otherwise, use the local file system
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
