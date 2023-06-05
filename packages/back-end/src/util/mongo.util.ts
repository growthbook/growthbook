/**
 * Assists in migrating any field options that MongoDB has changed between major versions 3 and 4.
 * Replaces the query with an equivalent where keys that can be mapped 1-to-1 are replaced with their new values.
 * @return ResultDeprecatedKeysMigrationV3to4
 *
 * Fields that are concerning and do not have 1-to-1 mappings:
 *  - autoReconnect: is no longer documented
 *  - reconnectTries: is no longer documented
 *  - reconnectInterval: is no longer documented
 *  - ha: is no longer documented
 *  - haInterval: is no longer documented
 *  - secondaryAcceptableLatencyMS: is no longer documented. Possibly related: maxStalenessSeconds
 *  - acceptableLatencyMS: is no longer documented. Possibly related: maxStalenessSeconds
 *  - connectWithNoPrimary: is no longer documented
 *  - w: still exists but is marked as deprecated -> writeConcern (incompatible types)
 *  - j: is no longer documented (journal write concern). -> writeConcern (incompatible types)
 *  - domainsEnabled: is no longer documented
 *  - bufferMaxEntries: is no longer documented
 *  - promiseLibrary: still exists but is marked as deprecated.
 *  - loggerLevel: still exists but is marked as deprecated.
 *  - logger: still exists but is marked as deprecated.
 */
export const getConnectionStringWithDeprecatedKeysMigratedForV3to4 = (
  uri: string
): ResultDeprecatedKeysMigrationV3to4 => {
  const v3to4Mappings: Record<string, string> = {
    poolSize: "maxPoolSize",
    tlsinsecure: "tlsInsecure",

    /**
     * @deprecated
     */
    wtimeout: "wtimeoutMS",

    appname: "appName",
  };

  try {
    const remapped: string[] = [];
    const parsedUrl = new URL(uri);

    const entries = Object.entries(v3to4Mappings);
    entries.forEach(([oldKey, newKey]) => {
      const value = parsedUrl.searchParams.get(oldKey);
      if (value) {
        remapped.push(oldKey);
        parsedUrl.searchParams.set(newKey, value);
        parsedUrl.searchParams.delete(oldKey);
      }
    });

    return {
      url: parsedUrl.toString(),
      success: true,
      remapped,
    };
  } catch (e) {
    return {
      url: uri,
      success: false,
      remapped: [],
    };
  }
};

/**
 * Result object for a MongoDB URI connection string migration attempt from v3 to v4.
 * Includes the modified URI, the deprecated old keys list, and whether the connection string modification was successful.
 */
type ResultDeprecatedKeysMigrationV3to4 = {
  /**
   * false when the URL fails to parse
   */
  success: boolean;

  /**
   * Modified URL
   */
  url: string;

  /**
   * Old keys that have been remapped
   */
  remapped: string[];
};
