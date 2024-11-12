module.exports = {
  "no-parseInt": {
    create: function (context) {
      return {
        MemberExpression(node) {
          if (
            node.object &&
            node.object.name === "Number" &&
            node.property &&
            node.property.name === "parseInt"
          )
            context.report(
              node,
              "Number.parseInt(...) is deprecated, please use Number(...)!"
            );
        },
        CallExpression(node) {
          if (node.callee && node.callee.name === "parseInt")
            context.report(
              node,
              "parseInt(...) is deprecated, please use Number(...)!"
            );
        },
      };
    },
  },
};
