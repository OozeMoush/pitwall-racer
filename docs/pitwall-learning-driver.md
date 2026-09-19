# Pitwall learned driver

This document describes the current Plan A path for #61: learn the fastest valid
Pitwall GP lap directly from the game's own physics, without hand-authoring a
racing line, corner targets, target speeds, or human-derived controls.

## Current direction: direct reinforcement learning

The authoritative environment is the real 120 Hz `RapierRacePhysics` world.
The agent observes normalized vehicle/track state and directly outputs the
game's three actuator channels:

- steering
- throttle
- brake

There is **no racing-line variable** in the RL policy. The racing line is an
output of the learned behavior and can be reconstructed from the final trace.

The current algorithm is Soft Actor-Critic (SAC), trained in PyTorch/CUDA while
multiple Rapier environments run in Node/TypeScript on CPU.

## What humans define vs what the agent learns

Humans define only the environment contract:

- the existing vehicle/chassis physics;
- the existing `SurfaceModel`;
- track geometry;
- the 18 generic vehicle/track observations;
- physical steer/throttle/brake action limits;
- hard validity rules;
- completion of a flying lap.

The agent learns:

- where to place the car;
- turn-in and steering behavior;
- braking timing/intensity;
- throttle timing/intensity;
- how to trade entry speed, minimum speed and exit speed;
- the resulting racing line.

The agent does not receive the old reference line, target speed, human PB, or
human telemetry.

## Reward and validity

There is intentionally no grass/runoff/kerb penalty coefficient.

A valid transition receives reward proportional only to **signed forward
physical progress**. The multiplier is a positive constant for numerical
conditioning and cannot change the optimum. SAC discounting makes faster
progress preferable.

Kerb/runoff/grass affect the car only through the real `SurfaceModel`.

Episodes terminate under the same hard rules used by the machine-lap evaluator:

- whole physical car leaves the road;
- impossible progress jump;
- sustained reverse.

An episode also ends when a valid flying lap is completed. A maximum episode
duration is only a training truncation.

## Environment architecture

`PitwallLearningStepEnvironment` is now the single stepwise environment used
by both RL and the existing deterministic evaluator. This prevents a Python
training simulator from drifting away from the actual game physics.

`scripts/learning/rl-server.ts` exposes a vector of these environments over a
small JSONL protocol. PyTorch sends normalized continuous actions; Node maps
them to the physical actuator ranges and advances Rapier.

The deterministic exported SAC actor is represented by
`PitwallSacPolicy.ts`, so a trained checkpoint can be replayed independently
inside the TypeScript/Rapier evaluator.

## Train on WSL + RTX

Install Node dependencies first:

```bash
npm install
```

Start SAC with the default CUDA configuration:

```bash
npm run learn:sac
```

The default run uses 16 Rapier environments and targets 1.5 million
transitions. Useful overrides can be passed after `--`:

```bash
npm run learn:sac -- \
  --envs 16 \
  --steps 1500000 \
  --eval-every 50000
```

For an initial smoke run:

```bash
npm run learn:sac -- \
  --envs 8 \
  --steps 100000 \
  --learning-starts 10000 \
  --eval-every 25000
```

CUDA is required by the npm convenience command. To deliberately use CPU:

```bash
uv run tools/learning/train_sac.py --device cpu --steps 100000
```

## Checkpoints

Training writes:

```text
artifacts/pitwall-learning/policy-sac-latest.json
artifacts/pitwall-learning/policy-sac-latest.pt
artifacts/pitwall-learning/policy-sac-latest.meta.json

artifacts/pitwall-learning/policy-sac-best.json
artifacts/pitwall-learning/policy-sac-best.pt
artifacts/pitwall-learning/policy-sac-best.meta.json
```

The `best` checkpoint follows the same validity hierarchy used elsewhere:
completed valid laps first, then game-equivalent lap time, then sub-tick time.
Before any policy can complete a lap, forward progress is only a lower-tier
curriculum signal.

Once the best deterministic actor completes a valid lap, it is also exported as:

```text
artifacts/pitwall-learning/policy-sac.json
artifacts/pitwall-learning/policy-sac.meta.json
```

Replay that policy independently with:

```bash
npm run learn:evaluate-sac
```

or:

```bash
npm run learn:evaluate-sac -- \
  artifacts/pitwall-learning/policy-sac-best.json
```

The independent Rapier replay is the promotion authority.

## Current external baseline

The frozen machine-only local-search checkpoint currently replays at:

- game-equivalent lap: **25.292 s**
- sub-tick diagnostic: **25.298093 s**

This checkpoint is a comparison baseline, not an RL target and not a reward
input. The observed human PB (~24.342 s) remains external sanity evidence only.

## Legacy local-search tooling

The branch still contains the earlier teacher, behavior-cloning, residual,
fine-residual, line, pair, joint and block-search experiments so their results
remain reproducible while PR #62 is draft.

They are now **frozen as baseline/prototyping tooling**. Do not keep adding
course-specific windows, knots or local search layers as the primary Plan A
path. The active path is the direct SAC policy described above.

## Promotion rule

Do not merge or call a learned policy a machine optimum because its training
reward looks good. It must complete a valid flying lap in the authoritative
Rapier evaluator and be independently replayable from the exported actor JSON.

Human data remains excluded from Plan A training.
