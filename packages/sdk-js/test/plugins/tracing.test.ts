import { Experiment, GrowthBook, GrowthBookClient } from "../../src";
import {
  getTracingTags,
  TRACING_TAG_EXPERIMENT_PREFIX,
  tracingPlugin,
} from "../../src/plugins/tracing";

describe("tracingPlugin", () => {
  const exp: Experiment<boolean> = {
    key: "my-experiment",
    variations: [false, true],
  };

  it("records a gb.exp:<experiment>=<variation> tag after run()", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    const res = gb.run(exp);

    expect(TRACING_TAG_EXPERIMENT_PREFIX).toBe("gb.exp");
    expect(getTracingTags(gb)).toEqual([`gb.exp:my-experiment=${res.key}`]);
    // Variation key defaults to the variation index
    expect(res.key).toBe(String(res.variationId));

    gb.destroy();
  });

  it("returns an empty array before any assignments", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });
    expect(getTracingTags(gb)).toEqual([]);
    gb.destroy();
  });

  it("records a single tag when the same experiment runs twice", () => {
    const onAssignment = jest.fn();
    const gb = new GrowthBook({
      plugins: [tracingPlugin({ onAssignment })],
      attributes: { id: "123" },
    });

    gb.run(exp);
    gb.run(exp);

    expect(getTracingTags(gb)).toHaveLength(1);
    expect(onAssignment).toHaveBeenCalledTimes(1);

    gb.destroy();
  });

  it("replaces the tag when the same experiment is reassigned", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    const first = gb.run(exp);
    let second = first;
    for (let i = 0; second.key === first.key; i++) {
      gb.setAttributes({ id: `other-${i}` });
      second = gb.run(exp);
    }

    expect(getTracingTags(gb)).toEqual([`gb.exp:my-experiment=${second.key}`]);

    gb.destroy();
  });

  it("returns tags sorted and copies them", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    gb.run({ ...exp, key: "zeta" });
    gb.run({ ...exp, key: "alpha" });

    const tags = getTracingTags(gb);
    expect(tags).toEqual([
      expect.stringMatching(/^gb\.exp:alpha=/),
      expect.stringMatching(/^gb\.exp:zeta=/),
    ]);

    tags.push("gb.exp:injected=0");
    expect(getTracingTags(gb)).toHaveLength(2);

    gb.destroy();
  });

  it("calls onAssignment with the assignment payload and user context", () => {
    const onAssignment = jest.fn();
    const gb = new GrowthBook({
      plugins: [tracingPlugin({ onAssignment })],
      attributes: { id: "123" },
    });

    const res = gb.run(exp);

    expect(onAssignment).toHaveBeenCalledWith(
      {
        experimentKey: "my-experiment",
        variationKey: res.key,
        hashAttribute: "id",
        hashValue: "123",
        tag: `gb.exp:my-experiment=${res.key}`,
      },
      { attributes: { id: "123" }, url: expect.any(String) },
    );

    gb.destroy();
  });

  it("uses variation meta keys when provided", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    const res = gb.run({
      ...exp,
      meta: [{ key: "control" }, { key: "treatment" }],
    });

    expect(["control", "treatment"]).toContain(res.key);
    expect(getTracingTags(gb)).toEqual([`gb.exp:my-experiment=${res.key}`]);

    gb.destroy();
  });

  it("skips experiment keys containing =", () => {
    const onAssignment = jest.fn();
    const gb = new GrowthBook({
      plugins: [tracingPlugin({ onAssignment })],
      attributes: { id: "123" },
    });

    gb.run({ ...exp, key: "bad=experiment" });

    expect(getTracingTags(gb)).toEqual([]);
    expect(onAssignment).not.toHaveBeenCalled();

    gb.destroy();
  });

  it("allows : in experiment keys and = or : in variation keys", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    const res = gb.run({
      ...exp,
      key: "llm:prompt",
      meta: [{ key: "a=b" }, { key: "c:d" }],
    });

    expect(getTracingTags(gb)).toEqual([`gb.exp:llm:prompt=${res.key}`]);

    gb.destroy();
  });

  it("a throwing onAssignment still records the tag", () => {
    const onAssignment = jest.fn(() => {
      throw new Error("boom");
    });
    const gb = new GrowthBook({
      plugins: [tracingPlugin({ onAssignment })],
      attributes: { id: "123" },
    });

    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    gb.run(exp);
    spy.mockRestore();

    expect(onAssignment).toHaveBeenCalledTimes(1);
    expect(getTracingTags(gb)).toHaveLength(1);

    gb.destroy();
  });

  it("records tags for feature-flag experiments evaluated via evalFeature", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
      features: {
        "my-feature": {
          defaultValue: "off",
          rules: [
            {
              key: "feature-exp",
              variations: ["a", "b"],
              weights: [0.5, 0.5],
              coverage: 1,
              hashAttribute: "id",
            },
          ],
        },
      },
    });

    const res = gb.evalFeature("my-feature");

    expect(res.source).toBe("experiment");
    expect(getTracingTags(gb)).toEqual([
      `gb.exp:feature-exp=${res.experimentResult?.key}`,
    ]);

    gb.destroy();
  });

  it("clears tags on destroy", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });

    gb.run(exp);
    expect(getTracingTags(gb)).toHaveLength(1);

    gb.destroy();
    expect(getTracingTags(gb)).toEqual([]);
  });

  describe("GrowthBookClient", () => {
    it("isolates tags per scoped instance", () => {
      const onAssignment = jest.fn();
      const client = new GrowthBookClient({
        plugins: [tracingPlugin({ onAssignment })],
      });

      const userA = client.createScopedInstance({ attributes: { id: "a" } });
      const userB = client.createScopedInstance({ attributes: { id: "b" } });
      const unused = client.createScopedInstance({ attributes: { id: "c" } });

      const resA = userA.runInlineExperiment(exp);
      const resB = userB.runInlineExperiment({ ...exp, key: "other" });

      expect(getTracingTags(userA)).toEqual([
        `gb.exp:my-experiment=${resA.key}`,
      ]);
      expect(getTracingTags(userB)).toEqual([`gb.exp:other=${resB.key}`]);
      expect(getTracingTags(unused)).toEqual([]);

      expect(onAssignment).toHaveBeenCalledTimes(2);
      expect(onAssignment.mock.calls[0][1]).toEqual({
        attributes: { id: "a" },
        url: undefined,
      });
      expect(onAssignment.mock.calls[1][1]).toEqual({
        attributes: { id: "b" },
        url: undefined,
      });

      client.destroy();
    });

    it("records tags for feature experiments on scoped instances", () => {
      const client = new GrowthBookClient({
        plugins: [tracingPlugin()],
      });
      client.initSync({
        payload: {
          features: {
            "my-feature": {
              defaultValue: "off",
              rules: [
                {
                  key: "feature-exp",
                  variations: ["a", "b"],
                  weights: [0.5, 0.5],
                  coverage: 1,
                  hashAttribute: "id",
                },
              ],
            },
          },
        },
      });

      const user = client.createScopedInstance({ attributes: { id: "1" } });
      const res = user.evalFeature("my-feature");

      expect(res.source).toBe("experiment");
      expect(getTracingTags(user)).toEqual([
        `gb.exp:feature-exp=${res.experimentResult?.key}`,
      ]);

      client.destroy();
    });
  });
});
