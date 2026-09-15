const UNSUPPORTED_REGEX_MESSAGE =
  "Regex URL patterns are not supported for URL Redirect experiments. Use Feature Flags for regex targeting.";

export function validateUrl(urlString: string): {
  isValid: boolean;
  message?: string;
} {
  try {
    const url = new URL(urlString);
    if (url.pathname.includes("*")) {
      return { isValid: false, message: UNSUPPORTED_REGEX_MESSAGE };
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { isValid: true };
    }

    return {
      isValid: false,
      message: `Incomplete URL. Specify a valid URL starting with "http:// or "https://"`,
    };
  } catch {
    if (!urlString.startsWith("http") && !urlString.startsWith("https")) {
      return {
        isValid: false,
        message: `Incomplete URL. Specify a valid URL starting with "http:// or "https://"`,
      };
    }
    return { isValid: false, message: "Invalid URL" };
  }
}
