# Pitwall Racer agent instructions

Keep this file compact. Detailed project operations live in `docs/PROJECT_OPERATIONS.md`; detailed gameplay verification lives in the repo skill.

- GitHub is authoritative. Do not use chat history or model memory as the source of current project state.
- At the start of substantial work, read `README.md`, `docs/PROJECT_STATE.md`, the relevant GitHub Issue, and any linked/open PR before editing.
- Use fresh `main` and the repository workflow: short-lived branch → PR → required CI → squash merge → branch deletion.
- Before ending substantial unfinished work, leave a durable GitHub checkpoint in the Issue/PR. Update `DESIGN.md` for durable product decisions and `docs/PROJECT_STATE.md` only when the project baseline changes materially.

- For changes involving driving physics, AI pace/behaviour, racing lines, lap/sector timing, pit entry, track limits, tyres, race penalties, or race HUD, use the `$pitwall-playtest` skill before editing.
- `src/simulation/` is authoritative race truth. Rendering/HUD may display state but must not become the source of physics or timing truth.
- Reproduce gameplay bugs with a deterministic regression/playtest whenever practical before fixing them.
- Do not weaken an existing test merely to make CI green. If intended behaviour changed, update an assertion only after explaining why the old invariant is no longer valid.
- The REFERENCE GHOST is a calibration instrument. Never apply race-CPU difficulty cheats, traffic logic, rubber-banding, or pit strategy to it.
- Race CPU difficulty may use a small stable car-performance advantage, but never player-position rubber-banding.
- Grand Prix track limits do not delete physical laps. Four wheels fully beyond the legal road is the warning condition; five warnings create the configured 5-second pit penalty. PLAYER racing-line eligibility is separate.
- During iteration, use `npm run test:fast` for the cheap unit/regression tier. For gameplay changes, also run `npm run test:playtest`. Use `npm run test:long` when changing multi-lap racing-line replay, multi-circuit physics, long-run CPU behaviour, or the machine reference. Before finishing any gameplay change, run the full `npm test` and `npm run build`. Report remaining failures instead of hiding them.
