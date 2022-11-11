import bodyParser from "body-parser";
import express from "express";
import fs from "fs";
import { getUploadsDir } from "../../services/files";
import { wrapController } from "../wrapController";
import * as uploadControllerRaw from "./upload.controller";
import { UPLOAD_METHOD } from "../../util/secrets";

const router = express.Router();

const uploadController = wrapController(uploadControllerRaw);

if (UPLOAD_METHOD === "local") {
  // Create 'upload' directory if it doesn't exist yet
  const uploadDir = getUploadsDir();
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }

  router.put(
    "/",
    bodyParser.raw({
      type: "image/*",
      limit: "10mb",
    }),
    uploadController.putUpload
  );
  router.use("/", express.static(uploadDir));

  // Stop upload requests from running any of the middleware defined below
  router.use("/", () => {
    return;
  });
} else {
  router.put("/", (req, res) => {
    return res.status(405).json({ error: "Method Not Allowed" });
  });
}

export { router as uploadsRouter };
