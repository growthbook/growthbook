import { OpenApiRoute } from "back-end/src/util/handler";
import { listCustomHooks } from "./listCustomHooks";
import { postCustomHook } from "./postCustomHook";
import { getCustomHook } from "./getCustomHook";
import { testCustomHook } from "./testCustomHook";
import { updateCustomHook } from "./updateCustomHook";
import { deleteCustomHook } from "./deleteCustomHook";
import { listCustomHookHistory } from "./listCustomHookHistory";
import { revertCustomHook } from "./revertCustomHook";

export const customHooksRoutes: OpenApiRoute[] = [
  listCustomHooks,
  postCustomHook,
  // `test` MUST precede the `:id` update route below; otherwise the literal
  // "test" segment would be captured as an id.
  testCustomHook,
  getCustomHook,
  listCustomHookHistory,
  revertCustomHook,
  updateCustomHook,
  deleteCustomHook,
];
