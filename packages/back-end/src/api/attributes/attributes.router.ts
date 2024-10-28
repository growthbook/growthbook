import { Router } from "express";
import { listAttributes } from "./listAttributes";
import { putAttribute } from "./putAttribute";
import { postAttribute } from "./postAttribute";
import { deleteAttribute } from "./deleteAttribute";

const router = Router();

router.get("/", listAttributes);
router.post("/", postAttribute);
router.put("/:property", putAttribute);
router.delete("/:property", deleteAttribute);

export default router;
