Use the $pitwall-playtest skill and take over as the primary autonomous playtester/fixer for Pitwall Racer.

Do not stop at code review or logging. Reproduce problems, measure them, fix root causes, and re-test in a loop. Do not ask me to manually play unless the remaining question is genuinely subjective.

Start from the current branch exactly as it is. It is expected to have failing AI/reference tests right now.

Priority order:

1. Restore a trustworthy baseline.
   - Run npm run test:playtest, npm test, and npm run build.
   - Investigate existing failures rather than weakening assertions just to get green.
   - Keep REFERENCE GHOST free of race-CPU difficulty cheats.

2. Build or improve autonomous gameplay verification.
   - If browser/computer-use or an existing browser-automation stack is available, launch the local Vite game and actually observe multiple laps.
   - If not, use simulation playtests and add a deterministic/headless autoplay or telemetry harness where needed.
   - Future bugs such as "one CPU stops forever", "laps stop counting", "pit entry stops working", "AI follows a bogus seam", and "M/H cars weave off line" should be detected without waiting for a human screenshot.

3. Fix the current AI pace/reliability gap.
   Latest manual Pitwall GP snapshot:
   - PLAYER PB ~22.975 s
   - reference ghost ~23.0 s
   - best race CPUs still ~25.8–27.5 s
   The stored PLAYER line is fast enough; race CPUs are losing too much in execution.
   Diagnose the loss before adding more raw speed. Compare race CPU telemetry against reference ghost at the same sections.
   Fastest Soft race CPUs should become a real threat and should trace the PLAYER line closely. Stable CPU-only grip/power assists are acceptable; player-position rubber-banding is not.

4. Verify fragile areas.
   - no CPU stalled near 0 km/h for >3 s in normal running;
   - no persistent huge path/lane error in clear air;
   - PLAYER line smooth/periodic through start-finish with no straight chord seam;
   - GP track limits only when all four visible wheels are out;
   - track-limit warnings never delete the physical GP lap;
   - S1/S2/S3 register with ordinary kerb use;
   - requested pit entry works after track-limit warnings;
   - impact tyre damage does not accumulate every frame during one contact.

5. Iterate until focused playtests, full tests, and build all pass unless a real external blocker exists. Add or improve regressions for fixes whenever practical.

At the end give a concise playtest report: reproduced failures, root causes, before/after telemetry, changes, commands/tests, and anything that still needs subjective human feel.

Do not make unrelated feature additions during this pass.
