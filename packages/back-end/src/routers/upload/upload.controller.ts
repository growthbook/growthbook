import { Request, Response } from "express";
import { uploadFile } from "../../services/files";

export async function putUpload(req: Request, res: Response) {
  const { signature, path } = req.query as { signature: string; path: string };
  await uploadFile(path, signature, req.body);

  res.status(200).json({
    status: 200,
  });
}
