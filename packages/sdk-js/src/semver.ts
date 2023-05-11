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

    if (sv.major !== svOther.major) {
      return false;
    }

    if (sv.minor !== svOther.minor) {
      return false;
    }

    if (sv.patch !== svOther.patch) {
      return false;
    }

    if (sv.prerelease !== svOther.prerelease) {
      return false;
    }

    return true;
  },
  neq(version: string, otherVersion: string): boolean {
    return !semver.eq(version, otherVersion);
  },
  gt(version: string, otherVersion: string): boolean {
    // TODO:
    return false;
  },
  gte(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return true;
    if (semver.gt(version, otherVersion)) return true;
    return false;
  },
  lt(version: string, otherVersion: string): boolean {
    // TODO:
    return false;
  },
  lte(version: string, otherVersion: string): boolean {
    if (semver.eq(version, otherVersion)) return true;
    if (semver.lt(version, otherVersion)) return true;
    return false;
  },
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
