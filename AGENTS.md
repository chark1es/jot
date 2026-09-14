# Agent instructions

## Unslop

Read the unslop skill and apply it to every piece of writing you produce: replies, commit messages, PR text, comments, and docs. Finish the unslop pass before the user sees the text.

## Documentation

Read the docs that cover the change before you edit.

- `CONTEXT.md` for product language. Use those terms.
- `PRODUCT.md` for purpose, constraints, and brand.
- `docs/technical-design.md` for architecture and the development plan.
- `docs/adr/` when a design choice is in play.
- `docs/runbooks/` when you are executing a phase or checking a ship gate.
- `docs/toolchains.md` when you need how the repo is built and tested.

## User preferences

When the user states a lasting preference, append it as a bullet in this section in the same turn. Write it as an instruction, not a quote.

- Always apply the Apple Design skill when reviewing or changing mobile UI.
- Keep typing and UI animations smooth, and verify interaction performance when changing either path.
- Prefer maintained Expo or platform packages for standard UI patterns instead of building custom replacements.
