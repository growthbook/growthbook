import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
  withRunExperiment,
  WithRunExperimentProps,
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
});
