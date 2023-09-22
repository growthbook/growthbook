import { Response } from "express";
import uniqid from "uniqid";
import { uploadFile } from "../../services/files";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";

export async function putUpload(req: AuthRequest<Buffer>, res: Response) {
  const contentType = req.headers["content-type"] as string;
  req.checkPermissions("addComments", "");

  const mimetypes: { [key: string]: string } = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/gif": "gif",
  };

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
  const fileName = uniqid("img_");
  const filePath = `${pathPrefix}${fileName}.${ext}`;
  const fileURL = await uploadFile(filePath, contentType, req.body);

  res.status(200).json({
    status: 200,
    fileURL,
  });
}
