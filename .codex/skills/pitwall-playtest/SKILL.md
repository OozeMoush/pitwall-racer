---
name: pitwall-playtest
description: Reproduce, measure, fix, and re-test Pitwall Racer gameplay regressions and race-balance problems.
---

# Pitwall Racer autonomous playtest workflow

Use this skill for AI behaviour, race pace, driving physics, racing-line replay, lap/sector counting, pit entry, track limits, tyre behaviour, contact damage, tow, penalties, and race-HUD changes.

## Start with evidence

1. Read `AGENTS.md`, `docs/PROJECT_STATE.md`, the relevant GitHub Issue, and `PLAYTEST.md`.
2. Run `npm run test:playtest`, then `npm test`, then `npm run build`.
3. Treat every existing failure as evidence. Do not change thresholds just because the current code misses them.
4. Inspect concrete telemetry before editing: actual/target speed, path/lane error, brake feedback/profile brake, throttle, progress branch, tyre/source grip, contact kind, and lap/sector/pit state.

## Reproduce before fixing

For each observed gameplay bug, create or extend a focused regression when practical. Reproduce the failure mechanism, not merely a screenshot.

Useful regressions include:
- CPU remains below 15 km/h for several seconds while target speed is high.
- Race CPU accumulates huge path error while the reference ghost stays close to the same PLAYER line.
- Start/finish interpolation creates a chord or phase jump.
- Legal kerb use creates a track-limit warning.
- Lap, sector, or pit entry fails after a valid physical circuit traversal.
- CPU difficulty boost leaks into the REFERENCE GHOST.

Do not encode transient magic numbers from one screenshot unless they represent an intentional product target.

## Run an actual playtest when tools allow it

If browser/computer-use capability or an already-installed browser automation stack is available:

1. Start Vite with `npm run dev -- --host 127.0.0.1`.
2. Open the local game.
3. Use Pitwall GP first because it has the strongest PLAYER-line baseline.
4. Use F3 telemetry when diagnosing AI.
5. Observe multiple laps, not one instant.
6. Capture lap times, stalls, path-error spikes, false penalties, missed sectors, failed pit entries, and visible racing-line discontinuities.
7. Re-test after every material fix.

If browser interaction is not available, do not claim a visual playtest. Use simulation/integration playtests and add deterministic instrumentation or a headless autoplay harness when that is the shortest path to reliable evidence.

## Autonomous iteration loop

Repeat until acceptance gates are met or a genuine external blocker exists:

1. Baseline.
2. Reproduce one failure.
3. Identify root cause.
4. Add or improve a regression.
5. Make the smallest coherent fix.
6. Run focused tests.
7. Run `npm run test:playtest`.
8. Run the full suite and build.
9. Compare telemetry with baseline.

Do not stop after merely adding logging.

## Gameplay acceptance gates

### AI reliability
- No race CPU nearly stationary for >3 seconds during normal running unless physically blocked or in pit service.
- A clear-running CPU must not remain tens of metres from its intended line.
- Stale projection branches must recover to the physically nearest plausible road.
- Medium/Hard may be slower but must trace a coherent line rather than weave.

### AI challenge
- With a good stored PLAYER line, fastest clear-air race CPUs should punish a player mistake.
- On the current Pitwall baseline, a ~22.98 s PLAYER PB with ~23.0 s reference-ghost replay should not leave the best race CPU stuck around 25.8–27 s solely because of controller inefficiency.
- Soft should be the most faithful/fastest CPU compound.
- Stable CPU-only grip/power assists are allowed. Player-position rubber-banding is not.
- Keep REFERENCE GHOST unassisted.

### Timing and pits
- Track limits in a Grand Prix never prevent the physical lap from counting.
- S1/S2/S3 and lap count continue through ordinary kerb use.
- Requested pit entry remains functional after prior track-limit warnings.
- Timing/pit detection follows physical circuit position; racing-line recording may use continuity-aware projection separately.

### Track limits
- Ordinary kerb use is legal.
- Warn only when the visible four-wheel footprint is fully beyond the legal road.
- Five GP warnings create the 5-second pit penalty; do not silently delete the lap.

### Racing-line continuity
- PLAYER line is periodic through start/finish.
- Never create a straight chord across a sparse seam and ask AI to chase it.
- Compare race CPU with REFERENCE GHOST to separate line-data problems from race-controller problems.

### Tyres/contact
- High wear creates meaningful late-stint risk.
- Wall/car impacts may add persistent tyre wear, but one continuous contact must not apply damage every physics frame.

## Completion report

Report:
- reproduced failures,
- root causes,
- code/tests changed,
- before/after telemetry,
- remaining risks,
- exact verification commands and results.

Do not ask the user to manually test something Codex can reproduce. Ask for human feel only when the remaining question is genuinely subjective.
