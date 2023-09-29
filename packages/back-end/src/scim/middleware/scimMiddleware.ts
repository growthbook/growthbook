// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function scimMiddleware(req: any, res: any, next: any) {
  const acceptHeader = req.get("Accept");

  // Check if the Accept header specifies SCIM JSON
  if (acceptHeader && acceptHeader.includes("application/scim+json")) {
    res.setHeader("Content-Type", "application/scim+json");
  }

  // Continue processing the request
  next();
}
