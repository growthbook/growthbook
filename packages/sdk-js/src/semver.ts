type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
};

export const semver = {
  valid(version: string): boolean {
    const sv = parseSemanticVersion(version);
    return !!sv;
  },
  eq(version: string, otherVersion: string): boolean {
    const sv = parseSemanticVersion(version);
    const svOther = parseSemanticVersion(otherVersion);

    if (!sv || !svOther) {
      throw new Error("Cannot compare invalid semantic versions");
    }

    // if major, minor, patch and prerelease don't match, return false
    if (sv.major !== svOther.major) return false;
    if (sv.minor !== svOther.minor) return false;
    if (sv.patch !== svOther.patch) return false;
    if (sv.prerelease !== svOther.prerelease) return false;

    // Everything that counts matches at this point
    return true;
  },
  neq(version: string, otherVersion: string): boolean {
    return !semver.eq(version, otherVersion);
  },
  gt(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return false;

    const sv = parseSemanticVersion(version);
    const svOther = parseSemanticVersion(otherVersion);

    if (!sv || !svOther) {
      throw new Error("Cannot compare invalid semantic versions");
    }

    if (sv.major < svOther.major) return false;
    if (sv.major > svOther.major) return true;

    // At this stage, major versions are the same. Check minor versions
    if (sv.minor < svOther.minor) return false;
    if (sv.minor > svOther.minor) return true;

    // At this stage, minor versions are the same. Check patch versions
    if (sv.patch < svOther.patch) return false;
    if (sv.patch > svOther.patch) return true;

    // At this stage, patch versions are the same. Check prerelease, if it exists

    // If version has no prerelease but otherVersion does, version is greater than otherVersion
    if (!sv.prerelease && svOther.prerelease) return true;

    // If version has a prerelease but otherVersion doesn't, otherVersion is greater than version
    if (sv.prerelease && !svOther.prerelease) return false;

    // At this stage, both have prerelease
    if (sv.prerelease && svOther.prerelease) {
      return prereleaseGt(sv.prerelease, svOther.prerelease);
    }

    return false;
  },
  gte(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return true;
    if (semver.gt(version, otherVersion)) return true;
    return false;
  },
  lt(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return false;
    return !semver.gt(version, otherVersion);
  },
  lte(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return true;
    if (semver.lt(version, otherVersion)) return true;
    return false;
  },
};

const comparePrereleaseSegment = (
  segment: string,
  otherSegment: string
): number => {
  // We may not have a segment
  if (typeof segment === "undefined" && typeof otherSegment === "undefined") {
    return 0;
  }

  if (typeof segment === "undefined") return -1;
  if (typeof otherSegment === "undefined") return 1;

  const allDigitsMatch = segment.match(/^\d*$/);
  const isAllDigits = (allDigitsMatch && !!allDigitsMatch[0]) || false;

  const allDigitsOtherMatch = otherSegment.match(/\d*/);
  const isOtherAllDigits =
    (allDigitsOtherMatch && !!allDigitsOtherMatch[0]) || false;

  if (isAllDigits && isOtherAllDigits) {
    // Both are all digits. Compare numerically.
    const intSegment = parseInt(segment);
    const intOtherSegment = parseInt(otherSegment);

    if (intSegment < intOtherSegment) return -1;
    if (intOtherSegment < intSegment) return 1;

    return 0;
  }

  // Numeric segments have lower precedence over alphanumeric segments
  if (isAllDigits && !isOtherAllDigits) return -1;
  if (isOtherAllDigits && !isAllDigits) return 1;

  // Compare alphanumerically
  if (segment < otherSegment) return -1;
  if (otherSegment < segment) return 1;

  // Should be equal at this point
  return 0;
};

const prereleaseGt = (prerelease: string, otherPrerelease: string): boolean => {
  const segments = prerelease.split(".");
  const otherSegments = otherPrerelease.split(".");

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const otherSegment = otherSegments[i];

    const comparison = comparePrereleaseSegment(segment, otherSegment);
    if (comparison === 0) continue;

    return comparison === 1;
  }

  // We shouldn't get here
  return false;
};

const parseSemanticVersion = (version: string): SemanticVersion | null => {
  try {
    if (version[0] === "v") {
      // We support the leading v even though it's not a valid semantic version
      version = version.substring(1, version.length);
    }

    // Ref: https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
    const result = version.match(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
    );
    if (!result) return null;

    const [, majorStr, minorStr, patchStr, prerelease, build] = result;
    const major = parseInt(majorStr);
    if (isNaN(major)) return null;

    const minor = parseInt(minorStr);
    if (isNaN(minor)) return null;

    const patch = parseInt(patchStr);
    if (isNaN(patch)) return null;

    const semanticVersion: SemanticVersion = {
      major,
      minor,
      patch,
      prerelease,
      build,
    };

    return semanticVersion;
  } catch (e) {
    return null;
  }
};
