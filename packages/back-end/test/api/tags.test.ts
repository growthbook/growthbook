import request from "supertest";
import { PermissionError, routeConfirmation } from "shared/util";
import { postTagValidator } from "shared/validators";
import { addTag, getAllTags } from "back-end/src/models/TagModel";
import { setupApp } from "./api.setup";

const ORG_ID = "org_tags";

describe("tags API", () => {
  const { app, auditMock, setReqContext } = setupApp();
  let canManageTags = true;

  beforeEach(() => {
    canManageTags = true;
    setReqContext({
      org: { id: ORG_ID, settings: {} },
      permissions: {
        canCreateAndUpdateTag: () => canManageTags,
        throwPermissionError: () => {
          throw new PermissionError("You do not have permission");
        },
      },
    });
  });

  const post = (body: unknown) =>
    request(app)
      .post("/api/v1/tags")
      .send(body as object)
      .set("Authorization", "Bearer foo");

  it("lists tags in stored order with the default color", async () => {
    await addTag(ORG_ID, "zeta", "", "");
    await addTag(ORG_ID, "alpha", "pink", "First");

    const res = await request(app)
      .get("/api/v1/tags")
      .set("Authorization", "Bearer foo");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tags: [
        { id: "zeta", color: "#029dd1", description: "" },
        { id: "alpha", color: "pink", description: "First" },
      ],
    });
  });

  it("lists tags without a permission check", async () => {
    canManageTags = false;
    const res = await request(app)
      .get("/api/v1/tags")
      .set("Authorization", "Bearer foo");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tags: [] });
  });

  it("creates a tag, leaving out fields as empty", async () => {
    const res = await post({ id: "checkout" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tag: { id: "checkout", color: "", description: "" },
    });
    expect(await getAllTags(ORG_ID)).toEqual([
      { id: "checkout", color: "#029dd1", description: "" },
    ]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("updates an existing tag and keeps left-out fields", async () => {
    await addTag(ORG_ID, "checkout", "blue", "Checkout flow");

    const res = await post({ id: "checkout", description: "Cart and pay" });

    expect(res.status).toBe(200);
    expect(res.body.tag).toEqual({
      id: "checkout",
      color: "blue",
      description: "Cart and pay",
    });
    expect(await getAllTags(ORG_ID)).toEqual([res.body.tag]);
  });

  it("writes the default color to an existing tag with no stored color", async () => {
    await addTag(ORG_ID, "checkout", "", "");

    const res = await post({ id: "checkout", description: "Cart" });

    expect(res.status).toBe(200);
    expect(res.body.tag.color).toBe("#029dd1");
  });

  it("refuses without manageTags", async () => {
    canManageTags = false;
    const res = await post({ id: "checkout", color: "blue" });

    expect(res.status).toBe(403);
    expect(await getAllTags(ORG_ID)).toEqual([]);
  });

  it.each([
    [{ id: "x" }],
    [{ id: "a".repeat(65) }],
    [{ id: "checkout", description: "d".repeat(257) }],
    [{ id: "checkout", name: "Checkout" }],
    [{ color: "blue" }],
  ])("refuses an invalid body %j", async (body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(await getAllTags(ORG_ID)).toEqual([]);
  });

  it("holds for confirmation rules that cover other.write", () => {
    expect(
      routeConfirmation(
        postTagValidator.method,
        postTagValidator.tags,
        postTagValidator.confirmation,
      ),
    ).toEqual(["other.write"]);
  });
});
