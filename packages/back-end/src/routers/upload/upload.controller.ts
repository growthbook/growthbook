import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getImageData, uploadFile } from "../../services/files";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";

const mimetypes: { [key: string]: string } = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

// Inverted object mapping extensions to mimetypes
const extensionsToMimetype: { [key: string]: string } = {};
for (const mimetype in mimetypes) {
  const extension = mimetypes[mimetype];
  extensionsToMimetype[extension] = mimetype;
}

export async function putUpload(req: AuthRequest<Buffer>, res: Response) {
  const contentType = req.headers["content-type"] as string;
  req.checkPermissions("addComments", "");

  if (!(contentType in mimetypes)) {
    throw new Error(
      `Invalid image file type. Only ${Object.keys(mimetypes).join(
        ", "
      )} accepted.`
    );
  }

  const ext = mimetypes[contentType];
  const { org } = getOrgFromReq(req);

  const now = new Date();
  const pathPrefix = `${org.id}/${now.toISOString().substr(0, 7)}/`;
  const fileName = "img_" + uuidv4();
  const filePath = `${pathPrefix}${fileName}.${ext}`;
  const fileURL = await uploadFile(filePath, contentType, req.body);

  res.status(200).json({
    status: 200,
    fileURL,
  });
}

export async function getImage(
  req: AuthRequest<{ path: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const path = req.path[0] === "/" ? req.path.substr(1) : req.path;

  const orgFromPath = path.split("/")[0];
  if (orgFromPath !== org.id) {
    throw new Error("Invalid organization");
  }

  const ext = path.split(".").pop() || "";
  const contentType = extensionsToMimetype[ext];

  if (!contentType) {
    throw new Error(`Invalid file extension: ${ext}`);
  }

  res.status(200).contentType(contentType);

  const stream = await getImageData(path);
  stream.pipe(res);
}
