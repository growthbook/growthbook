import {
  LocalStorageCompat,
  StickyAssignmentsDocument,
  StickyAttributeKey,
} from "./types/growthbook";

export interface CookieAttributes {
  expires?: number | Date | undefined;
  path?: string | undefined;
  domain?: string | undefined;
  secure?: boolean | undefined;
  sameSite?: "strict" | "Strict" | "lax" | "Lax" | "none" | "None" | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [property: string]: any;
}
export interface JsCookiesCompat<T = string> {
  set(
    name: string,
    value: string | T,
    options?: CookieAttributes
  ): string | undefined;
  get(name: string): string | T | undefined;
  get(): { [key: string]: string };
  remove(name: string, options?: CookieAttributes): void;
}

/**
 * Responsible for reading and writing documents which describe sticky bucket assignments.
 *
 * Getting assignments:
 * Given a user's identifier attribute (name & value), fetch the document which describes the user's bucket assignments.
 * Bucket assignments will be keyed by a composite key of experimentId and version: `${experimentId}__{version}`
 *
 * Setting assignments:
 * Given a user's identifier attribute (name & value) and an updated local document which describes the user's bucket assignments,
 * put (overwrite) the document in a persistent store.
 *
 * Optional: Get all assignments:
 * If provided, must return an array of all AssignmentDocuments given a record of identifier attributes (name: value).
 * If not provided, the SDK will fetch each attribute's AssignmentDocument individually.
 */
export abstract class StickyBucketService {
  abstract getAssignments(
    attributeName: string,
    attributeValue: string
  ): Promise<StickyAssignmentsDocument | null>;

  abstract saveAssignments(doc: StickyAssignmentsDocument): Promise<unknown>;

  async getAllAssignments(
    attributes: Record<string, string>
  ): Promise<Record<StickyAttributeKey, StickyAssignmentsDocument>> {
    const docs: Record<string, StickyAssignmentsDocument> = {};
    (
      await Promise.all(
        Object.entries(attributes).map(([attributeName, attributeValue]) =>
          this.getAssignments(attributeName, attributeValue)
        )
      )
    ).forEach((doc) => {
      if (doc) {
        const key = `${doc.attributeName}||${doc.attributeValue}`;
        docs[key] = doc;
      }
    });
    return docs;
  }
}

export class LocalStorageStickyBucketService extends StickyBucketService {
  private prefix: string;
  private localStorage: LocalStorageCompat | undefined;
  constructor({
    prefix = "gbStickyBuckets::",
    localStorage,
  }: {
    prefix?: string;
    localStorage?: LocalStorageCompat;
  } = {}) {
    super();
    this.prefix = prefix;
    this.localStorage = localStorage;
    try {
      if (!this.localStorage && globalThis.localStorage) {
        this.localStorage = globalThis.localStorage;
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }
  async getAssignments(attributeName: string, attributeValue: string) {
    const key = `${attributeName}||${attributeValue}`;
    let doc: StickyAssignmentsDocument | null = null;
    try {
      const raw = await this.localStorage?.getItem(this.prefix + key);
      const data = JSON.parse(raw || "{}");
      if (data.attributeName && data.attributeValue && data.assignments) {
        doc = data;
      }
    } catch (e) {
      // Ignore localStorage errors
    }
    return doc;
  }
  async saveAssignments(doc: StickyAssignmentsDocument) {
    const key = `${doc.attributeName}||${doc.attributeValue}`;
    await this.localStorage?.setItem(this.prefix + key, JSON.stringify(doc));
  }
}
export class ExpressCookieStickyBucketService extends StickyBucketService {
  /** intended to be used with cookieParser() middleware from npm: 'cookie-parser' **/
  private prefix: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private req: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private res: any;
  private cookieAttributes: CookieAttributes;
  constructor({
    prefix = "gbStickyBuckets::",
    req,
    res,
    cookieAttributes = {},
  }: {
    prefix?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res?: any;
    cookieAttributes?: CookieAttributes;
  } = {}) {
    super();
    this.prefix = prefix;
    this.req = req;
    this.res = res;
    this.cookieAttributes = cookieAttributes;
    if (!this.req)
      throw new Error("ExpressCookieStickyBucketService: missing req");
    if (!this.res)
      throw new Error("ExpressCookieStickyBucketService: missing res");
  }
  async getAssignments(attributeName: string, attributeValue: string) {
    const key = `${attributeName}||${attributeValue}`;
    let doc: StickyAssignmentsDocument | null = null;
    try {
      const raw = this.req?.cookies?.[this.prefix + key];
      const data = JSON.parse(raw || "{}");
      if (data.attributeName && data.attributeValue && data.assignments) {
        doc = data;
      }
    } catch (e) {
      // Ignore cookie errors
    }
    return doc;
  }
  async saveAssignments(doc: StickyAssignmentsDocument) {
    const key = `${doc.attributeName}||${doc.attributeValue}`;
    this.res?.cookie?.(
      this.prefix + key,
      JSON.stringify(doc),
      this.cookieAttributes
    );
  }
}

export class BrowserCookieStickyBucketService extends StickyBucketService {
  private prefix: string;
  private jsCookie: JsCookiesCompat | undefined;
  private cookieAttributes: CookieAttributes;
  constructor({
    prefix = "gbStickyBuckets::",
    jsCookie,
    cookieAttributes = {},
  }: {
    prefix?: string;
    jsCookie?: JsCookiesCompat;
    cookieAttributes?: CookieAttributes;
  } = {}) {
    super();
    this.prefix = prefix;
    this.jsCookie = jsCookie;
    this.cookieAttributes = cookieAttributes;
    if (!this.jsCookie)
      throw new Error(
        "BrowserCookieStickyBucketService: missing jsCookie implementation"
      );
  }
  async getAssignments(attributeName: string, attributeValue: string) {
    const key = `${attributeName}||${attributeValue}`;
    let doc: StickyAssignmentsDocument | null = null;
    try {
      const raw = await this.jsCookie?.get(this.prefix + key);
      const data = JSON.parse(raw || "{}");
      if (data.attributeName && data.attributeValue && data.assignments) {
        doc = data;
      }
    } catch (e) {
      // Ignore cookie errors
    }
    return doc;
  }
  async saveAssignments(doc: StickyAssignmentsDocument) {
    const key = `${doc.attributeName}||${doc.attributeValue}`;
    await this.jsCookie?.set(
      this.prefix + key,
      JSON.stringify(doc),
      this.cookieAttributes
    );
  }
}
