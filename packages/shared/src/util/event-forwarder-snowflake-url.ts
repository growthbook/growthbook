const SNOWFLAKE_HOST_SUFFIX = ".snowflakecomputing.com";

/** Legacy locator accounts include region/cloud as dot-separated segments. */
function accountHasRegionOrCloudSegment(account: string): boolean {
  return account.includes(".");
}

/** Bare locator: alphanumeric only, or locator-style prefix with optional `_suffix`. */
function looksLikeBareLocator(account: string): boolean {
  if (/^[a-z0-9]+$/i.test(account)) return true;
  return /^[a-z]{1,4}\d+(?:_[a-z0-9]+)?$/i.test(account);
}

/**
 * Optionally derives a Snowflake HTTPS URL from the datasource account identifier.
 * Never invents region/cloud — bare locators (e.g. `xy12345`) return null.
 */
export function tryDeriveSnowflakeAccessUrlFromAccount(
  account: string,
): string | null {
  const trimmed = account.trim();
  if (!trimmed) return null;

  if (
    !accountHasRegionOrCloudSegment(trimmed) &&
    looksLikeBareLocator(trimmed)
  ) {
    return null;
  }

  const hostname = `${trimmed.replace(/_/g, "-")}${SNOWFLAKE_HOST_SUFFIX}`;
  return `https://${hostname}`;
}

export function normalizeSnowflakeEventForwarderAccessUrl(
  input: string,
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Snowflake URL is required.");
  }

  let urlString = trimmed;
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Snowflake URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Snowflake URL must use http or https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(SNOWFLAKE_HOST_SUFFIX)) {
    throw new Error(
      `Snowflake URL hostname must end with ${SNOWFLAKE_HOST_SUFFIX}.`,
    );
  }

  const portSuffix =
    parsed.port && parsed.port !== "443" ? `:${parsed.port}` : "";
  return `https://${parsed.hostname}${portSuffix}`;
}
