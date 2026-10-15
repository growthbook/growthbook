import express from "express";
import compression from "compression";
import request from "supertest";
import { sendJsonWithSlicedList } from "back-end/src/util/slicedJson";

function appSending(
  fields: Record<string, unknown>,
  items: unknown[],
  signal: AbortSignal = new AbortController().signal,
) {
  const app = express();
  app.use(compression());
  app.get("/", (_req, res) => {
    void sendJsonWithSlicedList(res, fields, "items", items, signal);
  });
  return app;
}

const items = Array.from({ length: 250 }, (_, i) => ({
  id: `f_${i}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  note: i % 2 ? 'quote " and comma, ünicode' : null,
}));

describe("sendJsonWithSlicedList", () => {
  it("sends the same JSON as res.json, across yields", async () => {
    const res = await request(appSending({ status: 200, more: true }, items))
      .get("/")
      .set("Accept-Encoding", "identity");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.text).toBe(JSON.stringify({ status: 200, more: true, items }));
  });

  it("handles no other fields and an empty list", async () => {
    const res = await request(appSending({}, [])).get("/");
    expect(res.text).toBe('{"items":[]}');
  });

  it("answers a matching If-None-Match with 304, and a changed list with 200", async () => {
    const app = appSending({ status: 200 }, items);
    const first = await request(app).get("/");
    const etag = first.headers["etag"];
    expect(etag).toMatch(/^W\/"/);

    const again = await request(app).get("/").set("If-None-Match", etag);
    expect(again.status).toBe(304);

    const changed = await request(
      appSending({ status: 200 }, [...items, { id: "new" }]),
    )
      .get("/")
      .set("If-None-Match", etag);
    expect(changed.status).toBe(200);
    expect(changed.headers["etag"]).not.toBe(etag);
  });

  it("is compressed by the compression middleware", async () => {
    const res = await request(appSending({ status: 200 }, items))
      .get("/")
      .set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.text).toBe(JSON.stringify({ status: 200, items }));
  });

  it("sends nothing once the signal aborts", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const app = express();
    let headersSent = true;
    app.get("/", async (_req, res) => {
      await sendJsonWithSlicedList(
        res,
        { status: 200 },
        "items",
        items,
        aborted.signal,
      );
      headersSent = res.headersSent;
      res.status(204).end();
    });
    await request(app).get("/");
    expect(headersSent).toBe(false);
  });
});
