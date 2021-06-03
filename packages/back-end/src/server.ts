import app from "./app";

const server = app.listen(app.get("port"), () => {
  console.log(
    "  Back-end is running at http://localhost:%d in %s mode",
    app.get("port"),
    app.get("env")
  );
  console.log("  Press CTRL-C to stop\n");
});

export default server;
