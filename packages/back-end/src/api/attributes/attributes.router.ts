import { Router } from "express";
import { listAttributes } from "./listAttributes.js";
import { putAttribute } from "./putAttribute.js";
import { postAttribute } from "./postAttribute.js";
import { deleteAttribute } from "./deleteAttribute.js";

const router = Router();

router.get("/", listAttributes);
router.post("/", postAttribute);
router.put("/:property", putAttribute);
router.delete("/:property", deleteAttribute);

export default router;
