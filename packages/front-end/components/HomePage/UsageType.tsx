import Button from "@front-end/components/Button";

export default function UsageType({
  onSelect,
}: {
  onSelect: (usageType: "analysis" | "full") => Promise<void>;
}) {
  return (
    <div className="container mt-5">
      <h1>Welcome!</h1>
      <p style={{ fontSize: "1.2em" }}>
        Please choose the option which best describes your situation:
      </p>
      <div className="d-flex" style={{ minHeight: 300 }}>
        <Button
          color="light"
          style={{
            textAlign: "center",
            justifyContent: "center",
          }}
          className="border d-flex flex-column p-4 mr-3 rounded"
          onClick={async () => {
            await onSelect("analysis");
          }}
        >
          <h3 className="mb-3">
            I already run experiments and track them in a database or analytics
            tool.
          </h3>
          <p>
            GrowthBook can automate the analysis and let you easily document
            results.
          </p>
        </Button>
        <Button
          color="light"
          style={{
            textAlign: "center",
            justifyContent: "center",
          }}
          className="border d-flex flex-column p-4 rounded"
          onClick={async () => {
            await onSelect("full");
          }}
        >
          <h3 className="mb-3">
            I don&apos;t do any experimentation yet and need a full-featured
            platform.
          </h3>
          <p>
            GrowthBook has SDKs, APIs, Feature Flags, and Webhooks to deeply
            integrate into your existing tech stack.
          </p>
        </Button>
      </div>
    </div>
  );
}
