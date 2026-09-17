# Pitwall learned driver

This is an experimental machine-only driver for discovering the fastest valid
Pitwall GP lap without hand-authoring a racing line or target-speed profile.

The learned policy sees only normalized vehicle/track observations and directly
outputs the game's real three actuator channels: steering, throttle and brake.
Throttle and brake remain independent so learning does not discard transient
control strategies that the physical car can actually execute.

## Rule model

There is intentionally no numeric off-track reward penalty.

- Kerb/runoff/grass affects the car only through the real `SurfaceModel`.
- A policy is invalid when the whole physical car leaves the road, when track
  progress makes a physically impossible jump, or when it substantially
  reverses around the circuit.
- Valid completed policies are compared only by flying-lap time.
- Incomplete/invalid policies may use forward progress only as a curriculum or
  tie-break signal; they can never outrank a valid completed lap.

This prevents a tunable penalty coefficient from defining the racing line. If a
small amount of kerb/runoff is physically faster, the learner is free to use it.

## Architecture

The current policy is a tiny deterministic MLP:

- 12 observations
- hidden layers: 16, 16
- 3 actions: steer, throttle, brake

Observations contain speed, yaw rate, lateral position, heading error, Pitwall
progress encoding, and signed track-heading changes at 12/25/45/70/100 m ahead.
The policy does **not** receive the old reference line, target speed, human PB,
or human telemetry.

The authoritative rollout is the real `RapierRacePhysics` world with the same
fresh Soft grip, surface model, power baseline, tyre-slide logic, chassis and
safety barriers as the player car.

## Local workflow (WSL)

Install/update Node dependencies first:

```bash
npm install
```

The complete pipeline can then be started with one command:

```bash
npm run learn:local
```

The individual stages are below if you want to inspect or tune them separately.

### 1. Export the current machine-only teacher

```bash
npm run learn:teacher
```

This writes:

```text
artifacts/pitwall-learning/teacher.jsonl
artifacts/pitwall-learning/teacher.meta.json
```

The teacher is the current machine-only absolute controller. Human telemetry is
not included. Each sample preserves exact `steer`, `throttle`, and `brake`.

### 2. Behavior-clone the teacher with PyTorch

The trainer uses PEP 723 metadata, so `uv` creates an isolated Python
environment automatically:

```bash
uv run tools/learning/train_teacher.py
```

It selects CUDA automatically when `torch.cuda.is_available()` is true and
prints the GPU name. Override with `--device cpu` or `--device cuda`.

Output:

```text
artifacts/pitwall-learning/policy-teacher.json
artifacts/pitwall-learning/policy-teacher.meta.json
```

### 3. Verify the neural policy in the real Rapier world

```bash
npm run learn:evaluate
```

A useful clone should complete a valid lap. A small supervised MSE is not enough
by itself: closed-loop Rapier execution is the authority.

### 4. Evolve the neural policy directly against Rapier

```bash
npm run learn:evolve -- --generations 80 --population 20
```

The first implementation uses mirrored sparse Gaussian mutations around the
best valid policy. Each candidate is driven through the real Rapier world and
ranked lexicographically by validity/completion/lap time rather than by a
weighted reward formula.

The best checkpoint is written to:

```text
artifacts/pitwall-learning/policy-evolved.json
artifacts/pitwall-learning/policy-evolved.meta.json
```

Evaluate it explicitly with:

```bash
npm run learn:evaluate -- artifacts/pitwall-learning/policy-evolved.json
```

Useful evolution controls:

```text
--generations N
--population N
--sigma X
--mutation-rate X
--seed N
--input FILE
--output FILE
```

The one-command pipeline accepts environment variables for the main evolution
settings, for example:

```bash
GENERATIONS=120 POPULATION=32 npm run learn:local
```

## CPU vs GPU

The PyTorch behavior-cloning phase can use the RTX 4070 through CUDA. It is a
small network, so this phase is not computationally demanding.

The expensive part is evolutionary rollout: every candidate must execute the
Rapier physics loop. Rapier currently runs on CPU, so GPU utilization will be
low during `learn:evolve`. This is expected. Parallel rollout workers are the
next performance optimization if single-process rollout becomes the bottleneck.

If/when SAC/PPO is added, neural-network updates can use CUDA while Rapier
rollouts remain CPU-side unless the physics environment is replaced or batched
on another backend.

## Promotion rule

A learned policy must not be promoted merely because an approximate evaluator
reports a fast time. The policy must complete a valid flying lap in the real
Rapier environment. Machine-only learning remains Plan A; the known human PB is
only an external comparison number, never a training target.
