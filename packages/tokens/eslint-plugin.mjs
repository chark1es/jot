/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: {
    name: "@jot/tokens",
    version: "0.0.0",
  },
  rules: {
    "no-raw-design-values": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Forbid raw hex/rgb/hsl colors outside @jot/tokens. Use generated tokens.",
        },
        messages: {
          raw: 'Raw design value "{{value}}". Import a token from @jot/tokens instead.',
        },
        schema: [],
      },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        if (
          filename.includes("/packages/tokens/") ||
          filename.includes("/generated/") ||
          /(?:^|\/)tokens\.json$/.test(filename)
        ) {
          return {};
        }
        return {
          Program() {
            const source = context.sourceCode.getText();
            const regex =
              /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/g;
            for (const match of source.matchAll(regex)) {
              const index = match.index ?? 0;
              const before = source.slice(0, index);
              const lines = before.split("\n");
              const last = lines.at(-1);
              context.report({
                loc: {
                  line: lines.length,
                  column: last === undefined ? 0 : last.length,
                },
                messageId: "raw",
                data: { value: match[0] },
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
