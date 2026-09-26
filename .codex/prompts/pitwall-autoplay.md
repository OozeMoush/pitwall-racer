Use the $pitwall-playtest skill and take over as the primary autonomous playtester/fixer for Pitwall Racer.

Do not stop at code review or logging. Reproduce problems, measure them, fix root causes, and re-test in a loop. Do not ask me to manually play unless the remaining question is genuinely subjective.

Start from the current branch exactly as it is. The expected baseline is green; treat any failure as a new regression until evidence shows otherwise.

Priority order:

1. Establish the current baseline.
   - Run `npm run test:playtest`, `npm test`, and `npm run build`.
   - Investigate failures rather than weakening assertions just to get green.
   - Keep REFERENCE GHOST free of race-CPU difficulty cheats.

2. Reproduce the reported problem.
   - Prefer a deterministic regression that exercises the real subsystem.
   - If browser/computer-use or an existing browser-automation stack is available, launch the local Vite game and observe multiple laps.
   - Otherwise use simulation/integration playtests and telemetry.
   - Do not preserve old screenshot numbers as permanent targets; collect fresh evidence on the current build.

3. Protect the fragile areas.
   - no CPU stalled near 0 km/h for >3 s in normal running unless physically blocked or in service;
   - no persistent huge path/lane error in clear air;
   - PLAYER line smooth/periodic through start/finish with no straight chord seam;
   - REFERENCE GHOST remains unassisted;
   - compact grid launches cleanly independent of which driver occupies P2;
   - GP track-limit warnings never delete the physical lap;
   - S1/S2/S3 register with ordinary kerb use;
   - requested pit entry works after track-limit warnings;
   - committed undercut/overcut decisions do not flip on the next tick;
   - impact tyre damage does not accumulate every frame during one contact;
   - all selectable circuits remain physically driveable, including Baku Street.

4. Diagnose pace before tuning it.
   - Compare race CPU telemetry against REFERENCE GHOST at the same sections.
   - Separate line-data, projection, braking-phase and controller losses.
   - Stable CPU-only grip/power assists are acceptable.
   - Player-position rubber-banding is not.

5. Iterate until focused playtests, the playtest gate, the full suite and build all pass unless a real external blocker exists.

At the end give a concise report: reproduced failures, root causes, before/after telemetry, changes, commands/tests, and anything that still needs subjective human feel.

Do not make unrelated feature additions during a bug-fix pass.
