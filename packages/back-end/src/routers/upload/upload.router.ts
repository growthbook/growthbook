import bodyParser from "body-parser";
import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as uploadControllerRaw from "./upload.controller.js";

const router = express.Router();

const uploadController = wrapController(uploadControllerRaw);

router.get("/signed-url/:path*", uploadController.getSignedImageToken);
router.post(
  "/signed-url-for-upload",
  bodyParser.json(),
  uploadController.getSignedUploadToken,
);
router.get("/:path*", uploadController.getImage);
router.put(
  "/",
  bodyParser.raw({
    type: "image/*",
    limit: "10mb",
  }),
  uploadController.putUpload,
);

export { router as uploadRouter };
