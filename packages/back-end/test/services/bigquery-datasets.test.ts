import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { mergeDataSourceParams } from "shared/util";
import {
  listBigQueryDatasets,
  bigQueryDatasetRequestSchema,
} from "back-end/src/services/bigquery-datasets";

let mockDefaultEndpoint: string;
const mockGetRequestHeaders = jest.fn();
const mockFromJSON = jest.fn<
  { getRequestHeaders: typeof mockGetRequestHeaders },
  [unknown, { transporterOptions: { signal: AbortSignal; retry: boolean } }]
>(() => ({ getRequestHeaders: mockGetRequestHeaders }));

jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: class {
    baseUrl: string;
    authClient = { fromJSON: mockFromJSON };
    constructor(options: { apiEndpoint?: string }) {
      this.baseUrl = `${options.apiEndpoint ?? mockDefaultEndpoint}/bigquery/v2`;
    }
  },
}));
jest.mock("back-end/src/util/http.util", () => ({
  ...jest.requireActual("back-end/src/util/http.util"),
  getHttpOptions: () => ({}),
}));

const credentials = {
  projectId: "example-project",
  clientEmail: "test@example.invalid",
  privateKey: "synthetic-private-key",
};
const dataset = (id: string) => ({ datasetReference: { datasetId: id } });

describe("listBigQueryDatasets", () => {
  let server: Server;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetRequestHeaders.mockResolvedValue(
      new Headers({ authorization: "Bearer synthetic-token" }),
    );
    requests = [];
    respond = (req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ datasets: [dataset("analytics")] }));
    };
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP address");
    mockDefaultEndpoint = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    jest.useRealTimers();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it.each([undefined, ""])(
    "uses the default endpoint for %p",
    async (apiEndpoint) => {
      await expect(
        listBigQueryDatasets({ ...credentials, apiEndpoint }),
      ).resolves.toEqual({ datasets: ["analytics"], truncated: false });
      expect(requests[0].url).toBe(
        "/bigquery/v2/projects/example-project/datasets?maxResults=100",
      );
      expect(requests[0].headers.authorization).toBe("Bearer synthetic-token");
    },
  );

  it("preserves the proxy path and pages through encoded tokens", async () => {
    respond = (req, res) => {
      const secondPage = new URL(
        req.url || "",
        mockDefaultEndpoint,
      ).searchParams.get("pageToken");
      res.end(
        JSON.stringify(
          secondPage
            ? { datasets: [dataset("second")] }
            : { datasets: [dataset("first")], nextPageToken: "next?&/#" },
        ),
      );
    };
    await expect(
      listBigQueryDatasets({
        ...credentials,
        apiEndpoint: `${mockDefaultEndpoint}/tenant/bigquery/v2/`,
      }),
    ).resolves.toEqual({ datasets: ["first", "second"], truncated: false });
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("/tenant/bigquery/v2/projects/");
    expect(
      new URL(requests[1].url || "", mockDefaultEndpoint).searchParams.get(
        "pageToken",
      ),
    ).toBe("next?&/#");
  });

  it("uses stored credentials when replacing or clearing an endpoint", async () => {
    const params = mergeDataSourceParams(
      "bigquery",
      { ...credentials, apiEndpoint: "https://old.example.com" },
      { privateKey: "", apiEndpoint: "" },
    );
    await listBigQueryDatasets(params);
    expect(mockFromJSON).toHaveBeenCalledWith(
      {
        client_email: credentials.clientEmail,
        private_key: credentials.privateKey,
      },
      expect.objectContaining({
        transporterOptions: expect.objectContaining({ retry: false }),
      }),
    );
  });

  it("stops at 10 pages even when the endpoint returns no datasets", async () => {
    respond = (req, res) =>
      res.end(JSON.stringify({ nextPageToken: String(requests.length) }));
    await expect(listBigQueryDatasets(credentials)).resolves.toEqual({
      datasets: [],
      truncated: true,
    });
    expect(requests).toHaveLength(10);
  });

  it("stops on repeated page tokens", async () => {
    respond = (req, res) =>
      res.end(JSON.stringify({ nextPageToken: "repeat" }));
    await expect(listBigQueryDatasets(credentials)).resolves.toEqual({
      datasets: [],
      truncated: true,
    });
    expect(requests).toHaveLength(2);
  });

  it("caps results even if the endpoint ignores the requested page size", async () => {
    respond = (req, res) =>
      res.end(
        JSON.stringify({
          datasets: Array.from({ length: 1001 }, (value, index) =>
            dataset(`dataset_${index}`),
          ),
        }),
      );
    const result = await listBigQueryDatasets(credentials);
    expect(result.truncated).toBe(true);
    expect(result.datasets).toHaveLength(1000);
    expect(result.datasets.at(-1)).toBe("dataset_999");
    expect(requests).toHaveLength(1);
  });

  it("does not truncate a complete list of exactly 1000 datasets", async () => {
    respond = (req, res) =>
      res.end(
        JSON.stringify({
          datasets: Array.from({ length: 100 }, (value, index) =>
            dataset(`dataset_${requests.length}_${index}`),
          ),
          ...(requests.length < 10
            ? { nextPageToken: String(requests.length) }
            : {}),
        }),
      );
    const result = await listBigQueryDatasets(credentials);
    expect(result.truncated).toBe(false);
    expect(result.datasets).toHaveLength(1000);
    expect(requests).toHaveLength(10);
  });

  it("enforces the decompressed response size", async () => {
    respond = (req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(
        gzipSync(JSON.stringify({ ignored: "x".repeat(5 * 1024 * 1024) })),
      );
    };
    await expect(listBigQueryDatasets(credentials)).rejects.toThrow(
      "5 MiB limit",
    );
  });

  it("does not retry or return the upstream error body", async () => {
    respond = (req, res) => {
      res.statusCode = 503;
      res.end("secret-upstream-message");
    };
    await expect(listBigQueryDatasets(credentials)).rejects.toThrow(
      "BigQuery dataset discovery failed (HTTP 503).",
    );
    expect(requests).toHaveLength(1);
  });

  it.each([
    "not JSON",
    JSON.stringify({ datasets: [{ datasetReference: { datasetId: 123 } }] }),
  ])("rejects an invalid response", async (body) => {
    respond = (req, res) => res.end(body);
    await expect(listBigQueryDatasets(credentials)).rejects.toThrow(
      /Could not fetch BigQuery datasets|invalid dataset list/,
    );
  });

  it("rejects invalid inputs before authentication or network requests", async () => {
    await expect(
      listBigQueryDatasets({
        ...credentials,
        apiEndpoint: "http://user:password@proxy.example.com",
      }),
    ).rejects.toThrow("cannot contain embedded credentials");
    await expect(
      listBigQueryDatasets({ projectId: "project" }),
    ).rejects.toThrow("are required");
    expect(mockFromJSON).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it.each([false, true])(
    "aborts a stalled response with headers sent: %p",
    async (sendHeaders) => {
      jest.useFakeTimers({
        doNotFake: [
          "nextTick",
          "setImmediate",
          "queueMicrotask",
          "performance",
          "hrtime",
        ],
      });
      let closed: Promise<unknown> | null = null;
      respond = (req, res) => {
        closed = once(res, "close");
        if (sendHeaders) res.write('{"datasets":[');
      };
      const arrived = once(server, "request");
      const result = expect(listBigQueryDatasets(credentials)).rejects.toThrow(
        "timed out",
      );
      await arrived;
      jest.advanceTimersByTime(30_000);
      await result;
      await closed;
      expect(requests).toHaveLength(1);
    },
  );

  it("shares the deadline across pages", async () => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "queueMicrotask",
        "performance",
        "hrtime",
      ],
    });
    let signalSecondPage: () => void = () => {
      throw new Error("No listener");
    };
    const secondPage = new Promise<void>((resolve) => {
      signalSecondPage = resolve;
    });
    respond = (req, res) => {
      if (requests.length === 1) {
        jest.advanceTimersByTime(20_000);
        res.end(JSON.stringify({ nextPageToken: "next" }));
      } else {
        signalSecondPage();
      }
    };
    const result = expect(listBigQueryDatasets(credentials)).rejects.toThrow(
      "timed out",
    );
    await secondPage;
    jest.advanceTimersByTime(10_000);
    await result;
    expect(requests).toHaveLength(2);
  });

  it("passes cancellation to authentication and clears the deadline after success", async () => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "queueMicrotask",
        "performance",
        "hrtime",
      ],
    });
    await listBigQueryDatasets(credentials);
    const signal = mockFromJSON.mock.calls[0][1].transporterOptions.signal;
    jest.advanceTimersByTime(30_000);
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("bigQueryDatasetRequestSchema", () => {
  it("validates project scope and connection field types", () => {
    expect(
      bigQueryDatasetRequestSchema.safeParse({ projects: ["project_a"] })
        .success,
    ).toBe(true);
    expect(
      bigQueryDatasetRequestSchema.safeParse({ projects: "project_a" }).success,
    ).toBe(false);
    expect(
      bigQueryDatasetRequestSchema.safeParse({ private_key: {} }).success,
    ).toBe(false);
  });
});
