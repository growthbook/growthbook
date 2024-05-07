import bodyParser from "body-parser";
import express from "express";
import { wrapController } from "../wrapController";
import * as uploadControllerRaw from "./upload.controller";

const router = express.Router();

const uploadController = wrapController(uploadControllerRaw);

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
