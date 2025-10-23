import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  uploadFile,
  getSignedImageUrl,
  getSignedUploadUrl,
  getImageData,
} from "back-end/src/services/files";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getOrganizationById,
} from "back-end/src/services/organizations";
import {
  SignedImageUrlResponse,
  SignedUploadUrlResponse,
  UploadResponse,
} from "back-end/types/upload";
import { UPLOAD_METHOD } from "back-end/src/util/secrets";
import { getExperimentByUid } from "back-end/src/models/ExperimentModel";

const SIGNED_IMAGE_EXPIRY_MINUTES = 15;

const mimetypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

// Inverted object mapping extensions to mimetypes
const extensionsToMimetype: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
};

export async function putUpload(
  req: AuthRequest<Buffer>,
  res: Response<UploadResponse>,
) {
  // Only handle direct uploads for local storage
  if (UPLOAD_METHOD !== "local") {
    throw new Error(
      "Direct uploads are only supported for local storage. Use /upload/signed-url-for-upload for cloud storage.",
    );
  }

  const contentType = req.headers["content-type"] as string;
  const context = getContextFromReq(req);

  if (context.org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  // The user can upload images if they have permission to add comments globally, or in atleast 1 project
  if (!context.permissions.canAddComment([])) {
    context.permissions.throwPermissionError();
  }

  if (!(contentType in mimetypes)) {
    throw new Error(
      `Invalid image file type. Only ${Object.keys(mimetypes).join(
        ", ",
      )} accepted.`,
    );
  }

  const ext = mimetypes[contentType];

  const now = new Date();
  const pathPrefix = `${context.org.id}/${now.toISOString().substr(0, 7)}/`;
  const fileName = "img_" + uuidv4();
  const filePath = `${pathPrefix}${fileName}.${ext}`;
  const fileURL = await uploadFile(filePath, contentType, req.body);

  res.status(200).json({
    status: 200,
    fileURL,
  });
}

export function getImage(req: AuthRequest<{ path: string }>, res: Response) {
  const { org } = getContextFromReq(req);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  const path = req.path[0] === "/" ? req.path.substr(1) : req.path;

  const orgFromPath = path.split("/")[0];
  if (orgFromPath !== org.id) {
    throw new Error("Invalid organization");
  }

  const ext = path.split(".")?.pop()?.toLowerCase() ?? "";
  const contentType = extensionsToMimetype[ext] ?? "";

  if (!contentType) {
    throw new Error(`Invalid file extension: ${ext}`);
  }

  res.status(200).contentType(contentType);

  const stream = getImageData(path);
  stream.pipe(res);
}

export async function getSignedImageToken(
  req: AuthRequest<{ path: string }>,
  res: Response<SignedImageUrlResponse>,
) {
  const { org } = getContextFromReq(req);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  const fullPath = req.path.substring("/signed-url/".length);

  const orgFromPath = fullPath.split("/")[0];
  if (orgFromPath !== org.id) {
    throw new Error("Invalid organization");
  }

  const signedUrl = await getSignedImageUrl(
    fullPath,
    SIGNED_IMAGE_EXPIRY_MINUTES,
  );

  res.status(200).json({
    signedUrl,
    expiresAt: new Date(
      Date.now() + SIGNED_IMAGE_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString(),
  });
}

export async function getSignedUploadToken(
  req: AuthRequest<{ contentType?: string }>,
  res: Response<SignedUploadUrlResponse>,
) {
  const context = getContextFromReq(req);
  const { org } = getContextFromReq(req);

  if (org.settings?.blockFileUploads) {
    throw new Error("File uploads are disabled for this organization");
  }

  // The user can upload images if they have permission to add comments globally, or in at least 1 project
  if (!context.permissions.canAddComment([])) {
    context.permissions.throwPermissionError();
  }

  const contentType = req.body?.contentType;

  if (!contentType || !(contentType in mimetypes)) {
    throw new Error(
      `Invalid or missing content type. Only ${Object.keys(mimetypes).join(
        ", ",
      )} accepted.`,
    );
  }

  const ext = mimetypes[contentType];
  const now = new Date();
  const pathPrefix = `${org.id}/${now.toISOString().substr(0, 7)}/`;
  const fileName = "img_" + uuidv4();
  const filePath = `${pathPrefix}${fileName}.${ext}`;

  const { signedUrl, fileUrl } = await getSignedUploadUrl(
    filePath,
    contentType,
    SIGNED_IMAGE_EXPIRY_MINUTES,
  );

  res.status(200).json({
    signedUrl,
    fileUrl,
    filePath,
    expiresAt: new Date(
      Date.now() + SIGNED_IMAGE_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString(),
  });
}

export async function getSignedPublicImageToken(
  req: Request<{ path: string }>,
  res: Response<SignedImageUrlResponse | { status: number; message: string }>,
) {
  // Get the experiment UID from query parameter
  const experimentUid = req.query.experimentUid as string | undefined;

  if (!experimentUid) {
    res.status(400).json({
      status: 400,
      message: "Missing experimentUid query parameter",
    });
    return;
  }

  // Look up the experiment by UID
  const experiment = await getExperimentByUid(experimentUid);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  // Verify the experiment is publicly shared
  if (experiment.shareLevel !== "public") {
    res.status(403).json({
      status: 403,
      message: "Experiment is not publicly shared",
    });
    return;
  }

  // Get the organization to check settings
  const org = await getOrganizationById(experiment.organization);

  if (!org) {
    res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
    return;
  }

  if (org.settings?.blockFileUploads) {
    res.status(403).json({
      status: 403,
      message: "File uploads are disabled for this organization",
    });
    return;
  }

  // Extract the image path from the request
  // The route is /upload/public-signed-url/:path* so req.path will be like:
  // /upload/public-signed-url/org_xxx/2025-10/img_xxx.jpeg
  const fullPath = req.path.substring("/upload/public-signed-url/".length);

  // Verify the org in the path matches the experiment's organization
  const orgFromPath = fullPath.split("/")[0];
  if (orgFromPath !== experiment.organization) {
    res.status(403).json({
      status: 403,
      message: "Invalid organization",
    });
    return;
  }

  // Verify the image path exists in the experiment (variations or description markdown)
  let imageFound = false;

  // Check variation screenshots
  for (const variation of experiment.variations) {
    if (variation.screenshots) {
      for (const screenshot of variation.screenshots) {
        // Extract the path from the screenshot URL if it's a full URL
        let screenshotPath = screenshot.path;
        try {
          const url = new URL(screenshot.path);
          screenshotPath = url.pathname;
          // Remove leading slash if present
          if (screenshotPath.startsWith("/")) {
            screenshotPath = screenshotPath.substring(1);
          }
          // Remove /upload/ prefix if present
          if (screenshotPath.startsWith("upload/")) {
            screenshotPath = screenshotPath.substring(7);
          }
        } catch {
          // Not a full URL, use as-is
        }

        if (screenshotPath === fullPath || screenshot.path.includes(fullPath)) {
          imageFound = true;
          break;
        }
      }
      if (imageFound) break;
    }
  }

  // Check description for image references
  if (
    !imageFound &&
    experiment.description &&
    experiment.description.includes(fullPath)
  ) {
    imageFound = true;
  }

  if (!imageFound) {
    res.status(404).json({
      status: 404,
      message: "Image not found in experiment data",
    });
    return;
  }

  // Generate the signed URL
  const signedUrl = await getSignedImageUrl(
    fullPath,
    SIGNED_IMAGE_EXPIRY_MINUTES,
  );

  res.status(200).json({
    signedUrl,
    expiresAt: new Date(
      Date.now() + SIGNED_IMAGE_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString(),
  });
}
