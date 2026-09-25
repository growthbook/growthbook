import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { putConfig } from "back-end/src/routers/config/config.controller";
import { setupApp } from "../api/api.setup";

/**
 * A Config revert must be able to CLEAR a schema — including in the same request
 * that changes lineage. Explicit null is the clear signal: `undefined` is dropped
 * by JSON.stringify and read as "not intentionally changed".
 *
 * The combination case is the one that matters: a schema resurrected via `??` and
 * normalized against the NEW ancestors persists a remnant instead of the clear.
 * The fixture needs an ancestor that owns a key in the cleared schema so
 * normalization has something to strip.
 */

const ORG_ID = "org_config_schema_clear";
const org = {
  id: ORG_ID,
  name: "Config Schema Clear",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

describe("clearing a Config schema through the internal PUT", () => {
  setupApp();

  const resSpy = () => {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    return { res, captured };
  };

  const putFor = (body: Record<string, unknown>) =>
    ({
      params: { id: "cfg_child" },
      body,
      query: { autoPublish: "1" },
      organization: org,
      userId: "u_admin",
      email: "a@t.co",
      name: "A",
      headers: {},
    }) as unknown as Parameters<typeof putConfig>[0];

  beforeEach(async () => {
    for (const c of ["configs", "revisions"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    // The ancestor owns `sharedField`, so normalizing the child's schema against it
    // STRIPS that key — the behaviour that turns a resurrected schema into a
    // non-null remnant rather than an untouched copy.
    await mongoose.connection.collection("configs").insertOne({
      id: "cfg_parent",
      organization: ORG_ID,
      key: "cfg_parent",
      name: "parent",
      owner: "",
      project: "",
      value: JSON.stringify({ sharedField: "p" }),
      schema: {
        type: "object",
        fields: [
          {
            key: "sharedField",
            type: "string" as const,
            required: false,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("configs").insertOne({
      id: "cfg_child",
      organization: ORG_ID,
      key: "cfg_child",
      name: "child",
      owner: "",
      project: "",
      value: JSON.stringify({ sharedField: "c", ownField: "o" }),
      schema: {
        type: "object",
        fields: [
          {
            key: "sharedField",
            type: "string" as const,
            required: false,
            default: "",
            description: "",
            enum: [],
          },
          {
            key: "ownField",
            type: "string" as const,
            required: false,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  });

  const storedSchema = async () =>
    (
      await mongoose.connection
        .collection("configs")
        .findOne({ organization: ORG_ID, id: "cfg_child" })
    )?.schema ?? null;

  it("clears the schema when that is the only change", async () => {
    const { res, captured } = resSpy();
    await putConfig(putFor({ schema: null }), res);

    expect(captured.status).toBe(200);
    expect(await storedSchema()).toBeNull();
  });

  it("clears the schema when the same request also changes lineage", async () => {
    // With `schemaToNormalize = fieldsToUpdate.schema ?? existing.schema`, the
    // null falls through, the lineage change opens the normalization guard, the
    // ancestor-owned key is stripped, and the REMNANT is written — the clear
    // silently becomes a partial schema.
    const { res, captured } = resSpy();
    await putConfig(putFor({ schema: null, parent: "cfg_parent" }), res);

    expect(captured.status).toBe(200);
    expect(await storedSchema()).toBeNull();
  });

  it("still normalizes a REAL schema against a new ancestor", async () => {
    // The control: the normalization this guard exists for must still happen. A fix
    // that simply skipped the block whenever lineage changed would pass both cases
    // above and break this.
    const { res, captured } = resSpy();
    await putConfig(
      putFor({
        parent: "cfg_parent",
        schema: {
          type: "object",
          fields: [
            {
              key: "sharedField",
              type: "string" as const,
              required: false,
              default: "",
              description: "",
              enum: [],
            },
            {
              key: "ownField",
              type: "string" as const,
              required: false,
              default: "",
              description: "",
              enum: [],
            },
          ],
        },
      }),
      res,
    );

    expect(captured.status).toBe(200);
    const schema = (await storedSchema()) as {
      fields?: { key: string }[];
    } | null;
    // `sharedField` belongs to the parent now, so the child's copy is stripped.
    expect(schema?.fields?.map((f) => f.key)).toEqual(["ownField"]);
  });
});
