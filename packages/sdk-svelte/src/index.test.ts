import { afterEach, describe, it, expect } from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";
import html from "svelte-htm";
import { GrowthBook } from "@growthbook/growthbook";
import GrowthBookProvider from "./lib/GrowthBookProvider.svelte";
import ExperimentTest from "./components/ExperimentTest.svelte";
import FeaturesReadyTest from "./components/FeaturesReadyTest.svelte";
import ComponentThatCallsUseGrowthBookWithTypes from "./components/ComponentThatCallsUseGrowthBookWithTypes.svelte";
import ComponentThatCallsUseFeatureIsOn from "./components/ComponentThatCallsUseFeatureIsOn.svelte";
import ComponentThatCallsUseFeatureIsOnUntyped from "./components/ComponentThatCallsUseFeatureIsOnUntyped.svelte";
import ComponentThatCallsUseGrowthBook from "./components/ComponentThatCallsUseGrowthBook.svelte";

afterEach(cleanup);

describe("GrowthBookProvider", () => {
  it("renders without crashing and doesn't add additional html", () => {
    const growthbook = new GrowthBook({ user: { id: "123" } });

    const { container } = render(
      html`<${GrowthBookProvider} growthbook=${growthbook}>
        <h1>Hello World</h1>
      <//>`
    );

    const expected =
      "<div><h1>Hello World</h1><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
    growthbook.destroy();
  });

  it("runs an experiment with the useExperiment hook", () => {
    const growthbook = new GrowthBook({ user: { id: "123" } });

    const { container } = render(
      html`<${GrowthBookProvider} growthbook=${growthbook}>
        <${ExperimentTest} />
      <//>`
    );

    const expected =
      "<div><h1>1</h1><!--<ExperimentTest>--><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
    growthbook.destroy();
  });

  it("returns the control when there is no user", () => {
    const growthbook = new GrowthBook({});

    const { container } = render(
      html`<${GrowthBookProvider} growthbook=${growthbook}>
        <${ExperimentTest} />
      <//>`
    );

    const expected =
      "<div><h1>0</h1><!--<ExperimentTest>--><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
    growthbook.destroy();
  });

  it("returns the control when there is no growthbook instance", () => {
    const { container } = render(
      html`<${GrowthBookProvider}>
        <${ExperimentTest} />
      <//>`
    );

    const expected =
      "<div><h1>0</h1><!--<ExperimentTest>--><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
  });
});

describe("FeaturesReady", () => {
  it("renders immediately if ready", async () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: "actual value",
        },
      },
    });

    const { container } = render(FeaturesReadyTest, { growthbook });

    const expected =
      "<div><div>actual value</div><!--<FeatureComponent>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(expected);
    growthbook.destroy();
  });

  it("re-renders when features set and no timeout", async () => {
    const growthbook = new GrowthBook({});

    const { component, container } = render(FeaturesReadyTest, { growthbook });

    const expected =
      "<div><div>loading fallback</div><!--<Fallback>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(expected);

    growthbook.setFeatures({
      feature: {
        defaultValue: "actual value",
      },
    });

    await act(() => component.$set({ growthbook }));

    const secondExpected =
      "<div><div>actual value</div><!--<FeatureComponent>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(secondExpected);
    growthbook.destroy();
  });

  it("re-renders when timeout is hit", async () => {
    const growthbook = new GrowthBook({});

    const { component, container } = render(FeaturesReadyTest, {
      growthbook,
      timeout: 100,
    });

    const expected =
      "<div><div>loading fallback</div><!--<Fallback>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(expected);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const secondExpected =
      "<div><div>inline fallback</div><!--<FeatureComponent>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(secondExpected);

    growthbook.setFeatures({
      feature: {
        defaultValue: "actual value",
      },
    });

    await act(() => component.$set({ growthbook }));

    const thirdExpected =
      "<div><div>actual value</div><!--<FeatureComponent>--><!--<FeaturesReady>--><!--<GrowthBookProvider>--><!--<FeaturesReadyTest>--></div>";

    expect(container.innerHTML).toBe(thirdExpected);
    growthbook.destroy();
  });
});

describe("with typed features", () => {
  type SampleAppFeatures = {
    foo: number;
    bar: boolean;
    baz: string;
  };

  const providedGrowthBook = new GrowthBook<SampleAppFeatures>({
    features: {
      foo: {
        defaultValue: 123,
      },
      bar: {
        defaultValue: true,
      },
      baz: {
        defaultValue: "baz",
      },
    },
    attributes: {
      id: "user-abc123",
    },
  });

  it("allows you to use a typed GrowthBook instance via typed useGrowthBook", () => {
    const { container } = render(
      html`<${GrowthBookProvider} growthbook=${providedGrowthBook}>
        <${ComponentThatCallsUseGrowthBookWithTypes} />
      <//>`
    );

    const expected =
      "<div><h1>foo: 123, bar: true, baz: baz</h1><!--<ComponentThatCallsUseGrowthBookWithTypes>--><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
  });

  it("allows you to use types when using the function useFeatureIsOn", () => {
    const { container } = render(
      html`<${GrowthBookProvider} growthbook=${providedGrowthBook}>
        <${ComponentThatCallsUseFeatureIsOn} />
      <//>`
    );

    const expected =
      "<div><h1>is on = Yes</h1><!--<ComponentThatCallsUseFeatureIsOn>--><!--<GrowthBookProvider>--></div>";

    expect(container.innerHTML).toBe(expected);
  });

  describe("useFeatureIsOn untyped", () => {
    it("allows you to not use types when using the function useFeatureIsOn", () => {
      const { container } = render(
        html`<${GrowthBookProvider} growthbook=${providedGrowthBook}>
          <${ComponentThatCallsUseFeatureIsOnUntyped} />
        <//>`
      );

      const expected =
        "<div><h1>is on = Yes</h1><!--<ComponentThatCallsUseFeatureIsOnUntyped>--><!--<GrowthBookProvider>--></div>";

      expect(container.innerHTML).toBe(expected);
    });
  });

  describe("useGrowthBook untyped", () => {
    it("allows you to use an untyped GrowthBook instance", () => {
      const { container } = render(
        html`<${GrowthBookProvider} growthbook=${providedGrowthBook}>
          <${ComponentThatCallsUseGrowthBook} />
        <//>`
      );

      const expected =
        "<div><h1>foo: 123, bar: true, baz: baz</h1><!--<ComponentThatCallsUseGrowthBook>--><!--<GrowthBookProvider>--></div>";

      expect(container.innerHTML).toBe(expected);
    });
  });
});
