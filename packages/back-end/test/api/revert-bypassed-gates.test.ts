import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

/**
 * A landing revert must report the approval it skipped.
 *
 * Every other publish surface returns `bypassedGates` on success, so a caller (or
 * an auditor reading the response) can tell "no approval was needed" apart from
 * "approval was needed and this caller waved it through". Revert returned neither
 * — and revert is the one landing path that rewrites live state from history, so
 * it is the surface where the distinction matters most.
 *
 * The two sources are reported separately because they mean different things: the
 * caller's own bypass authority, versus an org-wide setting that switched approval
 * off for reverts specifically. The second one never reaches `canBypass` at all —
 * it zeroes the requirement upstream — which is exactly why it went unreported.
 */

const ORG_ID = "org_revert_gates";
const KEY = "revert-gates";

const approvalRequired = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
    },
  ],
};

const baseOrg = {
  id: ORG_ID,
  name: "Revert Gates",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

describe("POST /api/v1/constants-revisions/:key/:version/revert reports bypassed gates", () => {
  const { app, setReqContext } = setupApp();
  const auth = { Authorization: "Bearer foo" };

  // An admin holds the bypass permission. `key_test` is an API key rather than a
  // JWT, which is what `canUseRestApiBypassSetting` requires before the org's
  // `restApiBypassesReviews` setting counts for anything.
  const useAdmin = (settings: Record<string, unknown>) => {
    const context = new ReqContextClass({
      org: { ...baseOrg, settings } as OrganizationInterface,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    // `requireReviews` only bites with the license, so without this every case
    // below would take the "no approval was required" path and the control would
    // be the only one actually asserting anything.
    context.hasPremiumFeature = () => true;
    setReqContext(context);
  };

  const seed = async () => {
    for (const c of ["constants", "revisions"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: `const_${KEY}`,
      organization: ORG_ID,
      key: KEY,
      name: "Revert gates",
      type: "string",
      value: "original",
      owner: "",
      project: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  /** Publish one revision so there is a prior published version to revert TO. */
  const publishNewValue = async (value: string): Promise<number> => {
    const created = await request(app)
      .post(`/api/v1/constants-revisions/${KEY}`)
      .send({})
      .set(auth);
    expect(created.status).toBe(200);
    const version = created.body.revision.version;

    const edited = await request(app)
      .put(`/api/v1/constants-revisions/${KEY}/${version}/value`)
      .send({ value })
      .set(auth);
    expect(edited.status).toBe(200);

    const published = await request(app)
      .post(`/api/v1/constants-revisions/${KEY}/${version}/publish`)
      .send({})
      .set(auth);
    expect(published.status).toBe(200);
    return version;
  };

  const revert = (version: number) =>
    request(app)
      .post(`/api/v1/constants-revisions/${KEY}/${version}/revert`)
      .send({ strategy: "publish" })
      .set(auth);

  it("reports the caller's own bypass when approval was required", async () => {
    useAdmin(approvalRequired);
    await seed();
    const first = await publishNewValue("v1");
    await publishNewValue("v2");

    const res = await revert(first);
    expect(res.status).toBe(200);
    expect(res.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "bypassApprovalPermission",
      },
    ]);
  });

  it("names the org's REST bypass ahead of the caller's permission", async () => {
    // Both hold here. The gate layer reports `restApiBypassesReviews` first for
    // `approval-required`, and the revert path has to agree — otherwise the same
    // caller gets a different answer from two endpoints for the same reason.
    useAdmin({ ...approvalRequired, restApiBypassesReviews: true });
    await seed();
    const first = await publishNewValue("v1");
    await publishNewValue("v2");

    const res = await revert(first);
    expect(res.status).toBe(200);
    expect(res.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "restApiBypassesReviews",
      },
    ]);
  });

  it("reports the org's reverts-bypass-approval setting", async () => {
    // The setting suppresses the requirement rather than clearing a gate, so it
    // arrives by a different route than the permission above and was the one that
    // reported nothing at all. `restApiBypassesReviews` is OFF here so the two
    // sources cannot be confused.
    useAdmin({ ...approvalRequired, revertsBypassApproval: true });
    await seed();
    const first = await publishNewValue("v1");
    await publishNewValue("v2");

    const res = await revert(first);
    expect(res.status).toBe(200);
    expect(res.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "revertsBypassApproval",
      },
    ]);
  });

  it("omits the field entirely when no approval was required", async () => {
    // The control, and the reason this is reported as a LIST rather than a
    // boolean: a revert that needed no approval must not look like one that
    // skipped it. A fix that always emitted the entry would pass both cases above.
    useAdmin({});
    await seed();
    const first = await publishNewValue("v1");
    await publishNewValue("v2");

    const res = await revert(first);
    expect(res.status).toBe(200);
    expect(res.body.bypassedGates).toBeUndefined();
  });
});
