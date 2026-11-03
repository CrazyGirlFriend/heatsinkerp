# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Scheduling design decisions

- The user's selected reference is Bryntum Scheduler's Tasks example, with Feishu Gantt as secondary inspiration.
- Keep serial numbers and quantities in separate columns. Put delivery task descriptions and business metadata in details.
- A material lot can occupy multiple teams at once. Show team plans and split quantities without pretending the entire lot is at a single node.
- Bars express planned start-to-transfer duration, not only transfer milestones. Overlapping batches get separate lanes.
- Use team colors, in-stock markers, progress fills and compact exception icons instead of repeated explanatory prose.
- Keep this prototype explicitly labeled as example data until connected to real business APIs. Use Chrome Playwright and clean up the task-owned browser after verification.

- Keep single-batch team rows at about 52 px and two overlapping batches at about 88 px; prioritize 13 px in-stock counts over small avatars.
- Use filled bars for material currently at a team, outlined pale bars for future work, and light checked bars for transferred work.
- Batch selection traces explicit material links upstream and downstream; never infer lineage from matching batch numbers. Only draw connections while a batch is selected.
- Final delivery dates use a 32 px flag target and short dashed stem; show the date on hover, focus or batch selection.
