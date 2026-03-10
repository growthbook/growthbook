import * as React from "react";
import { act } from "react-dom/test-utils";
import { cleanup, render } from "@testing-library/react";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
  withRunExperiment,
  WithRunExperimentProps,
  useGrowthBook,
  useFeatureIsOn,
  useFeatureValue,
  FeaturesReady,
} from "../src";

afterEach(cleanup);

const TestedComponent = () => {
  const { value } = useExperiment({
    key: "my-test",
    variations: [0, 1],
  });
  return <h1>{value}</h1>;
};

const TestedClassComponent = withRunExperiment(
  class TestedClassComponent extends React.Component<WithRunExperimentProps> {
    render() {
      const { value } = this.props.runExperiment({
        key: "my-test",
        variations: [0, 1],
      });
      return <h1>{value}</h1>;
    }
  },
);

describe("GrowthBookProvider", () => {
  it("renders without crashing and doesn't add additional html", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });

    const { container } = render(
      <GrowthBookProvider growthbook={growthbook}>
        <h1>Hello World</h1>
      </GrowthBookProvider>,
    );
    expect(container.innerHTML).toEqual("<h1>Hello World</h1>");
    growthbook.destroy();
  });

  it("runs an experiment with the useExperiment hook", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });

    const { container } = render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
    );
    expect(container.innerHTML).toEqual("<h1>1</h1>");
    growthbook.destroy();
  });

  it("works using the withRunExperiment HoC", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });

    const { container } = render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedClassComponent />
      </GrowthBookProvider>,
    );
    expect(container.innerHTML).toEqual("<h1>1</h1>");
    growthbook.destroy();
  });

  it("returns the control when there is no user", () => {
    const growthbook = new GrowthBook({});

    const { container } = render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
    );
    expect(container.innerHTML).toEqual("<h1>0</h1>");
    growthbook.destroy();
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

      const Fallback = () => <div>loading fallback</div>;
      const FeatureComponent = () => {
        const val = useFeatureValue("feature", "inline fallback");
        return <div>{val}</div>;
      };

      const { container } = render(
        <GrowthBookProvider growthbook={growthbook}>
          <FeaturesReady fallback={<Fallback />}>
            <FeatureComponent />
          </FeaturesReady>
        </GrowthBookProvider>,
      );
      expect(container.innerHTML).toEqual("<div>actual value</div>");

      growthbook.destroy();
    });

    it("re-renders when features set and no timeout", async () => {
      const growthbook = new GrowthBook({});

      const Fallback = () => <div>loading fallback</div>;
      const FeatureComponent = () => {
        const val = useFeatureValue("feature", "inline fallback");
        return <div>{val}</div>;
      };

      const { container } = render(
        <GrowthBookProvider growthbook={growthbook}>
          <FeaturesReady fallback={<Fallback />}>
            <FeatureComponent />
          </FeaturesReady>
        </GrowthBookProvider>,
      );
      expect(container.innerHTML).toEqual("<div>loading fallback</div>");

      act(() => {
        growthbook.setFeatures({
          feature: {
            defaultValue: "actual value",
          },
        });
      });
      expect(container.innerHTML).toEqual("<div>actual value</div>");

      growthbook.destroy();
    });

    it("re-renders when timeout is hit", async () => {
      const growthbook = new GrowthBook({});

      const Fallback = () => <div>loading fallback</div>;
      const FeatureComponent = () => {
        const val = useFeatureValue("feature", "inline fallback");
        return <div>{val}</div>;
      };

      const { container } = render(
        <GrowthBookProvider growthbook={growthbook}>
          <FeaturesReady fallback={<Fallback />} timeout={100}>
            <FeatureComponent />
          </FeaturesReady>
        </GrowthBookProvider>,
      );
      expect(container.innerHTML).toEqual("<div>loading fallback</div>");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(container.innerHTML).toEqual("<div>inline fallback</div>");

      act(() => {
        growthbook.setFeatures({
          feature: {
            defaultValue: "actual value",
          },
        });
      });
      expect(container.innerHTML).toEqual("<div>actual value</div>");

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
          defaultValue: 1337,
        },
        bar: {
          defaultValue: true,
        },
        baz: {
          defaultValue: "hello world",
        },
      },
      attributes: {
        id: "user-abc123",
      },
    });

    it("allows you to use a typed GrowthBook instance via typed useGrowthBook", () => {
      const ComponentThatCallsUseGrowthBookWithTypes = () => {
        const growthbook = useGrowthBook<SampleAppFeatures>();

        const fooValue = growthbook?.getFeatureValue("foo", -1);
        const barValue = growthbook?.getFeatureValue("bar", false);
        const bazValue = growthbook?.getFeatureValue("baz", "??");

        return (
          <h1>
            foo = {fooValue}, bar = {String(barValue)}, baz = {bazValue}
          </h1>
        );
      };

      const { container } = render(
        <GrowthBookProvider growthbook={providedGrowthBook}>
          <ComponentThatCallsUseGrowthBookWithTypes />
        </GrowthBookProvider>,
      );

      expect(container.innerHTML).toEqual(
        "<h1>foo = 1337, bar = true, baz = hello world</h1>",
      );
    });

    it("allows you to use types when using the hook useFeatureIsOn", () => {
      const ComponentThatCallsUseFeatureIsOn = () => {
        const isOn = useFeatureIsOn<SampleAppFeatures>("bar");

        const text = isOn ? "Yes" : "No";

        return <h1>is on = {text}</h1>;
      };

      const { container } = render(
        <GrowthBookProvider growthbook={providedGrowthBook}>
          <ComponentThatCallsUseFeatureIsOn />
        </GrowthBookProvider>,
      );

      expect(container.innerHTML).toEqual("<h1>is on = Yes</h1>");
    });

    describe("useFeatureIsOn untyped", () => {
      it("allows you to not use types when using the hook useFeatureIsOn", () => {
        const ComponentThatCallsUseFeatureIsOn = () => {
          const isOn = useFeatureIsOn("bar");

          const text = isOn ? "Yes" : "No";

          return <h1>is on = {text}</h1>;
        };

        const { container } = render(
          <GrowthBookProvider growthbook={providedGrowthBook}>
            <ComponentThatCallsUseFeatureIsOn />
          </GrowthBookProvider>,
        );

        expect(container.innerHTML).toEqual("<h1>is on = Yes</h1>");
      });
    });

    describe("useGrowthBook untyped", () => {
      it("allows you to use an untyped GrowthBook instance", () => {
        const ComponentThatCallsUseGrowthBookWithTypes = () => {
          const growthbook = useGrowthBook();

          const fooValue = growthbook?.getFeatureValue("foo", -1);
          const barValue = growthbook?.getFeatureValue("bar", false);
          const bazValue = growthbook?.getFeatureValue("baz", "??");

          return (
            <h1>
              foo = {fooValue}, bar = {String(barValue)}, baz = {bazValue}
            </h1>
          );
        };

        const { container } = render(
          <GrowthBookProvider growthbook={providedGrowthBook}>
            <ComponentThatCallsUseGrowthBookWithTypes />
          </GrowthBookProvider>,
        );

        expect(container.innerHTML).toEqual(
          "<h1>foo = 1337, bar = true, baz = hello world</h1>",
        );
      });
    });
  });
});
