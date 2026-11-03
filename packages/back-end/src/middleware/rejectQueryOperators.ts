import { RequestHandler } from "express";

// Path of the first `$`-prefixed key in a parsed query object, or null
export function findOperatorKey(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value)
      ? `${path}[${key}]`
      : path
        ? `${path}.${key}`
        : key;
    if (key.startsWith("$")) return childPath;
    const nested = findOperatorKey(child, childPath);
    if (nested) return nested;
  }
  return null;
}

// qs parses `?id[$ne]=x` into `{ id: { $ne: "x" } }`, an operator if it reaches a Mongo filter
export const rejectQueryOperators: RequestHandler = (req, res, next) => {
  const key = findOperatorKey(req.query);
  if (key) {
    return res
      .status(400)
      .json({ status: 400, message: `Invalid query parameter: ${key}` });
  }
  next();
};
