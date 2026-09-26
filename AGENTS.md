# Pitwall Racer agent instructions

Keep this file compact. Detailed gameplay verification lives in the repo skill.

- For changes involving driving physics, AI pace/behaviour, racing lines, lap/sector timing, pit entry, track limits, tyres, race penalties, or race HUD, use the `$pitwall-playtest` skill before editing.
- `src/simulation/` is authoritative race truth. Rendering/HUD may display state but must not become the source of physics or timing truth.
- Reproduce gameplay bugs with a deterministic regression/playtest whenever practical before fixing them.
- Do not weaken an existing test merely to make CI green. If intended behaviour changed, update an assertion only after explaining why the old invariant is no longer valid.
- The REFERENCE GHOST is a calibration instrument. Never apply race-CPU difficulty cheats, traffic logic, rubber-banding, or pit strategy to it.
- Race CPU difficulty may use a small stable car-performance advantage, but never player-position rubber-banding.
- Grand Prix track limits do not delete physical laps. Four wheels fully beyond the legal road is the warning condition; three warnings create the configured pit penalty. PLAYER racing-line eligibility is separate.
- Before finishing a gameplay change, run `npm run test:playtest`, then `npm test`, then `npm run build`. Report remaining failures instead of hiding them.
