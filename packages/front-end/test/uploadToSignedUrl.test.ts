import { uploadToSignedUrl } from "@/services/files";

// A stand-in for XMLHttpRequest that records the request and lets each test
// decide how it finishes.
class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  statusText = "";
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.(
      new ProgressEvent("progress", { lengthComputable: true, loaded, total }),
    );
  }
  finish(status: number, statusText = "") {
    this.status = status;
    this.statusText = statusText;
    this.onload?.();
  }
}

describe("uploadToSignedUrl", () => {
  const file = new File(["u1\nu2\n"], "ids.csv", { type: "text/csv" });

  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs an S3 form with the fields first and the file last", async () => {
    const done = uploadToSignedUrl({
      signedUrl: "https://bucket.s3.amazonaws.com",
      fields: { key: "a/b.csv", policy: "p" },
      file,
      contentType: "text/csv",
      onProgress: () => undefined,
    });
    const xhr = FakeXhr.last;
    xhr.finish(204);
    await done;

    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://bucket.s3.amazonaws.com");
    expect(xhr.body).toBeInstanceOf(FormData);
    const form = xhr.body as FormData;
    expect([...form.keys()]).toEqual(["key", "policy", "file"]);
    expect(form.get("key")).toBe("a/b.csv");
  });

  it("PUTs the file with its content type when there are no fields", async () => {
    const done = uploadToSignedUrl({
      signedUrl: "https://storage.googleapis.com/signed",
      fields: null,
      file,
      contentType: "text/csv",
      onProgress: () => undefined,
    });
    const xhr = FakeXhr.last;
    xhr.finish(200);
    await done;

    expect(xhr.method).toBe("PUT");
    expect(xhr.headers).toEqual({ "Content-Type": "text/csv" });
    expect(xhr.body).toBe(file);
  });

  it("reports progress as a fraction", async () => {
    const onProgress = vi.fn();
    const done = uploadToSignedUrl({
      signedUrl: "https://storage.googleapis.com/signed",
      fields: null,
      file,
      contentType: "text/csv",
      onProgress,
    });
    const xhr = FakeXhr.last;
    xhr.progress(25, 100);
    xhr.progress(100, 100);
    xhr.finish(200);
    await done;

    expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
  });

  it("rejects on an error status or a network error", async () => {
    const forbidden = uploadToSignedUrl({
      signedUrl: "https://storage.googleapis.com/signed",
      fields: null,
      file,
      contentType: "text/csv",
      onProgress: () => undefined,
    });
    FakeXhr.last.finish(403, "Forbidden");
    await expect(forbidden).rejects.toThrow("Upload failed: 403 Forbidden");

    const offline = uploadToSignedUrl({
      signedUrl: "https://storage.googleapis.com/signed",
      fields: null,
      file,
      contentType: "text/csv",
      onProgress: () => undefined,
    });
    FakeXhr.last.onerror?.();
    await expect(offline).rejects.toThrow("Upload failed: network error");
  });
});
