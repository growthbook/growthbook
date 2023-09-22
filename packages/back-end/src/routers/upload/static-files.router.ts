import fs from "fs";
import express from "express";
import { getUploadsDir } from "../../services/files";
import { UPLOAD_METHOD } from "../../util/secrets";
import * as uploadControllerRaw from "./upload.controller";
import { wrapController } from "../wrapController";

const router = express.Router();

const uploadController = wrapController(uploadControllerRaw);

if (UPLOAD_METHOD === "local") {
  // Create 'upload' directory if it doesn't exist yet
  const uploadDir = getUploadsDir();
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }
  router.use("/", express.static(uploadDir));
  // Stop upload requests from running any of the middleware defined below
  router.use("/", () => {
    return;
  });
} else {
  router.get("/:path*", uploadController.getImage);
}
export { router as staticFilesRouter };
