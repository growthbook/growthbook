import asyncHandler from "express-async-handler";
import { RequestHandler } from "express";

// Wrap every controller function in asyncHandler to catch errors properly
// eslint-disable-next-line
export function wrapController(controller: Record<string, RequestHandler<any>>): void {
  Object.keys(controller).forEach((key) => {
    if (typeof controller[key] === "function") {
      controller[key] = asyncHandler(controller[key]);
    }
  });
}
