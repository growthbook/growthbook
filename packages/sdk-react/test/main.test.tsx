import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
  withRunExperiment,
  WithRunExperimentProps,
} from "../src";
//import { act } from "@testing-library/react";

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
  });

  it("returns the control when there is no user", () => {
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={new GrowthBook({})}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>0</h1>");
    ReactDOM.unmountComponentAtNode(div);
  });
  /*
  it("renders the variation switcher in dev mode", async () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const switcher = div.querySelector(".growthbook_dev");
    expect(switcher).toBeTruthy();
    ReactDOM.unmountComponentAtNode(div);
  });

  it("does not render the variation switcher when disableDevMode is set to true", async () => {
    const growthbook = new GrowthBook({
      user: { id: "1" },
      disableDevMode: true,
    });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const switcher = div.querySelector(".growthbook_dev");
    expect(switcher).toBeNull();
    ReactDOM.unmountComponentAtNode(div);
  });

  it("does not render the variation switcher when NODE_ENV is production", async () => {
    const node_env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const switcher = div.querySelector(".growthbook_dev");
    expect(switcher).toBeNull();
    ReactDOM.unmountComponentAtNode(div);

    process.env.NODE_ENV = node_env;
  });

  it("re-renders when switching variations", async () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>,
      div
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(div.querySelector("h1")?.innerHTML).toEqual("1");

    await act(async () => {
      // Click to switch to the first variation
      (div.querySelector(
        ".growthbook_dev tr:first-child"
      ) as HTMLElement)?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(div.querySelector("h1")?.innerHTML).toEqual("0");

    ReactDOM.unmountComponentAtNode(div);
  });

  it("starts variation switcher collapsed and expands when clicked", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");

      ReactDOM.render(
        <GrowthBookProvider growthbook={growthbook}>
          <TestedComponent />
        </GrowthBookProvider>,
        div
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(div.querySelector(".growthbook_dev")?.className).not.toMatch(
        /open/
      );

      // Click to expand the variation switcher
      await act(async () => {
        (div.querySelector(".growthbook_dev .toggle") as HTMLElement)?.click();
      });

      expect(div.querySelector(".growthbook_dev")?.className).toMatch(/open/);

      ReactDOM.unmountComponentAtNode(div);
    });
  });

  it("does not render variation switcher until the useExperiment hook is used", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const div = document.createElement("div");

    ReactDOM.render(
      <GrowthBookProvider growthbook={growthbook}>
        <h1>foo</h1>
      </GrowthBookProvider>,
      div
    );
    expect(div.innerHTML).toEqual("<h1>foo</h1>");
    ReactDOM.unmountComponentAtNode(div);
  });
  */
});
