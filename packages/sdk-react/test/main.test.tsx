import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
  withRunExperiment,
  WithRunExperimentProps,
  useGrowthBook,
  useFeatureIsOn,
} from "../src";

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
  }
);

describe("GrowthBookProvider", () => {
  it("renders without crashing and doesn't add additional html", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");
    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <h1>Hello World</h1>
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>Hello World</h1>");
    ReactDOM.unmountComponentAtNode(div);
    growthbook.destroy();
  });

  it("runs an experiment with the useExperiment hook", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>1</h1>");
    ReactDOM.unmountComponentAtNode(div);
    growthbook.destroy();
  });

  it("works using the withRunExperiment HoC", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedClassComponent />
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>1</h1>");
    ReactDOM.unmountComponentAtNode(div);
    growthbook.destroy();
  });

  it("returns the control when there is no user", () => {
    const div = document.createElement("div");

    const growthbook = new GrowthBook({});

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>0</h1>");
    ReactDOM.unmountComponentAtNode(div);
    growthbook.destroy();
  });

  it("returns the control when there is no growthbook instance", () => {
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>0</h1>");
    ReactDOM.unmountComponentAtNode(div);
  });

  describe("with typed features", () => {
    let div = document.createElement("div");

    beforeEach(() => {
      div = document.createElement("div");
    });

    afterEach(() => {
      ReactDOM.unmountComponentAtNode(div);
    });

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

      ReactDOM.render(
        <GrowthBookProvider growthbook={providedGrowthBook}>
          <ComponentThatCallsUseGrowthBookWithTypes />
        </GrowthBookProvider>,
        div
      );

      expect(div.innerHTML).toEqual(
        "<h1>foo = 1337, bar = true, baz = hello world</h1>"
      );
    });

    it("allows you to use types when using the hook useFeatureIsOn", () => {
      const ComponentThatCallsUseFeatureIsOn = () => {
        const isOn = useFeatureIsOn<SampleAppFeatures>("bar");

        const text = isOn ? "Yes" : "No";

        return <h1>is on = {text}</h1>;
      };

      ReactDOM.render(
        <GrowthBookProvider growthbook={providedGrowthBook}>
          <ComponentThatCallsUseFeatureIsOn />
        </GrowthBookProvider>,
        div
      );

      expect(div.innerHTML).toEqual("<h1>is on = Yes</h1>");
    });

    describe("useFeatureIsOn untyped", () => {
      it("allows you to not use types when using the hook useFeatureIsOn", () => {
        const ComponentThatCallsUseFeatureIsOn = () => {
          const isOn = useFeatureIsOn("bar");

          const text = isOn ? "Yes" : "No";

          return <h1>is on = {text}</h1>;
        };

        ReactDOM.render(
          <GrowthBookProvider growthbook={providedGrowthBook}>
            <ComponentThatCallsUseFeatureIsOn />
          </GrowthBookProvider>,
          div
        );

        expect(div.innerHTML).toEqual("<h1>is on = Yes</h1>");
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

        ReactDOM.render(
          <GrowthBookProvider growthbook={providedGrowthBook}>
            <ComponentThatCallsUseGrowthBookWithTypes />
          </GrowthBookProvider>,
          div
        );

        expect(div.innerHTML).toEqual(
          "<h1>foo = 1337, bar = true, baz = hello world</h1>"
        );
      });
    });
  });
});
