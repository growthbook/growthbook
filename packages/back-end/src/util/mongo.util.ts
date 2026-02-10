import type {
  AnyBulkWriteOperation,
  BulkWriteOptions,
  Document,
  Collection,
} from "mongodb";
import type { Document as MongooseDocument } from "mongoose";
import mongoose from "mongoose";
import { promiseAllChunks } from "./promise";

/**
 * Assists in migrating any field options that MongoDB has changed between major versions 3 and 4.
 * Replaces the query with an equivalent where keys that can be mapped 1-to-1 are replaced with their new values.
 *
 * Docs referenced:
 *  - v3 fields: https://mongodb.github.io/node-mongodb-native/3.7/reference/connecting/connection-settings/
 *  - v4 fields: https://mongodb.github.io/node-mongodb-native/4.16/interfaces/MongoClientOptions.html
 *
 * @return ResultDeprecatedKeysMigrationV3to4
 *
 * Unsupported deprecated fields that do not have 1-to-1 mappings.
 * Some fields no longer exist, while others are marked as deprecated in v4, which means they *could* be removed in the future.
 *
 * Note: Some v3 options were marked as deprecated but were included in v4 and not marked as deprecated. These have been ignored.
 *
 *  - autoReconnect: is no longer documented
 *  - reconnectTries: is no longer documented
 *  - reconnectInterval: is no longer documented
 *  - ha: is no longer documented
 *  - haInterval: is no longer documented
 *  - secondaryAcceptableLatencyMS: is no longer documented. Possibly related: maxStalenessSeconds
 *  - acceptableLatencyMS: is no longer documented. Possibly related: maxStalenessSeconds
 *  - connectWithNoPrimary: is no longer documented
 *  - w: still exists but is marked as deprecated -> writeConcern (incompatible types)
 *  - domainsEnabled: is no longer documented
 *  - bufferMaxEntries: is no longer documented
 *  - promiseLibrary: still exists but is marked as deprecated.
 *  - loggerLevel: still exists but is marked as deprecated.
 *  - logger: still exists but is marked as deprecated.
 */
export const getConnectionStringWithDeprecatedKeysMigratedForV3to4 = (
  uri: string,
): ResultDeprecatedKeysMigrationV3to4 => {
  const unsupportedV3FieldsInV4 = [
    "autoReconnect",
    "reconnectTries",
    "reconnectInterval",
    "ha",
    "haInterval",
    "secondaryAcceptableLatencyMS",
    "acceptableLatencyMS",
    "connectWithNoPrimary",
    "domainsEnabled",
    "bufferMaxEntries",
  ];
  const v3to4Mappings: Record<string, string> = {
    minSize: "minPoolSize",
    poolSize: "maxPoolSize",
    tlsinsecure: "tlsInsecure",

    /**
     * @deprecated use WriteConcern
     */
    wtimeout: "wtimeoutMS",

    /**
     * @deprecated use WriteConcern
     */
    j: "journal",

    appname: "appName",
  };

  try {
    const remapped: string[] = [];
    const [originalUrl, queryString] = uri.split("?");

    const searchParams = new URLSearchParams(queryString);

    // Replacements
    const entries = Object.entries(v3to4Mappings);
    entries.forEach(([oldKey, newKey]) => {
      const value = searchParams.get(oldKey);
      if (value) {
        remapped.push(oldKey);
        searchParams.set(newKey, value);
        searchParams.delete(oldKey);
      }
    });

    // Validation
    const unsupported: string[] = [];
    unsupportedV3FieldsInV4.forEach((oldKey) => {
      const value = searchParams.get(oldKey);
      if (value) {
        unsupported.push(oldKey);
      }
    });

    const modifiedParams = searchParams.toString();
    let modifiedUrl = originalUrl;
    if (modifiedParams) {
      modifiedUrl += "?" + modifiedParams;
    }

    return {
      url: modifiedUrl,
      success: true,
      remapped,
      unsupported,
    };
  } catch (e) {
    return {
      url: uri,
      success: false,
      remapped: [],
      unsupported: [],
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

  /**
   * Old keys that do not have a suitable v4 equivalent and/or require manual remapping.
   */
  unsupported: string[];
};

export type ToInterface<T> = (doc: Document | (MongooseDocument & T)) => T;
export function removeMongooseFields<T>(
  doc: Document | (MongooseDocument & T),
): T {
  if (doc.toJSON) {
    doc = doc.toJSON({ flattenMaps: true });
  }

  // Copy the object and delete mongoose fields rather than using lodash.omit for perf reasons since this is called a lot
  const result = { ...doc } as T & { _id?: string; __v?: unknown };
  delete result._id;
  delete result.__v;
  return result;
}

export function getCollection<T extends Document>(name: string) {
  return mongoose.connection.db.collection<T>(name);
}

/**
 * Attempts to perform a bulkWrite operation if supported by the collection. If not, falls back to chunked individual operations.
 * Supports updateOne and insertOne operations. Extend as needed for other op types.
 */
export async function safeBulkWrite(
  collection: Collection<Document>,
  ops: AnyBulkWriteOperation<Document>[],
  options?: BulkWriteOptions,
  chunkSize: number = 3,
): Promise<unknown> {
  if (typeof collection.bulkWrite === "function") {
    try {
      if (options) {
        return await collection.bulkWrite(ops, options);
      } else {
        return await collection.bulkWrite(ops);
      }
    } catch (e) {
      if (
        e instanceof Error &&
        e.message &&
        (e.message.includes("not implemented") ||
          e.message.includes("not supported") ||
          e.message.includes("not authorized"))
      ) {
        // Fallback to chunked operations
      } else {
        throw e;
      }
    }
  }
  // Fallback: chunked updates using promiseAllChunks
  return promiseAllChunks(
    ops.map((op) => async () => {
      if ("updateOne" in op) {
        if (options) {
          return collection.updateOne(
            op.updateOne.filter,
            op.updateOne.update,
            options,
          );
        } else {
          return collection.updateOne(op.updateOne.filter, op.updateOne.update);
        }
      } else if ("insertOne" in op) {
        if (options) {
          return collection.insertOne(op.insertOne.document, options);
        } else {
          return collection.insertOne(op.insertOne.document);
        }
      } else {
        throw new Error(
          "Unsupported bulkWrite operation type in safeBulkWrite",
        );
      }
    }),
    chunkSize,
  );
}
