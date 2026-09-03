import { z } from "zod";
import { runApiHandler } from "back-end/src/util/handler";

const withId = z.strictObject({ type: z.literal("a"), id: z.string() });
const withoutId = z.strictObject({ type: z.literal("a"), title: z.string() });
const body = z.object({ blocks: z.array(z.union([withoutId, withId])) });

const parse = (value: unknown) =>
  runApiHandler({ params: {}, query: {}, body: value }, { body }, async () => ({
    ok: true,
  }));

describe("runApiHandler validation errors", () => {
  it("names the offending key instead of reporting 'Invalid input'", async () => {
    const res = await parse({
      blocks: [{ type: "a", title: "t", organization: "org_1" }],
    });

    expect(res.status).toBe(400);
    const message = (res.body as { message: string }).message;
    // Previously the whole message was the union's own "[blocks.0] Invalid
    // input", which says nothing a caller can act on.
    expect(message).toContain('[blocks.0] Unrecognized key: "organization"');
    expect(message).not.toBe("Request body: [blocks.0] Invalid input");
  });

  it("keeps the path prefix of the union that failed", async () => {
    const res = await parse({
      blocks: [{ type: "a", title: "t" }, { type: "a" }],
    });

    const message = (res.body as { message: string }).message;
    expect(message).toContain("[blocks.1.title]");
  });

  it("reports non-union issues unchanged", async () => {
    const res = await parse({ blocks: "nope" });

    expect((res.body as { message: string }).message).toBe(
      "Request body: [blocks] Invalid input: expected array, received string",
    );
  });

  it("passes a valid body through to the handler", async () => {
    const res = await parse({ blocks: [{ type: "a", title: "t" }] });

    expect(res.status).toBe(200);
  });
});
