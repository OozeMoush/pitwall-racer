# Pitwall Racer — Playtest Gate

For gameplay/AI debugging with Codex, the repository includes the repo-scoped
`$pitwall-playtest` skill and an initial task at
`.codex/prompts/pitwall-autoplay.md`. The skill requires deterministic
regressions and autonomous playtest evidence before asking for human feel.

Human play remains the final judge for subjective fun, but lap counting, pit
entry, AI stalls, path errors, line seams, penalties, and pace regressions
should be automated wherever practical.

## Manual feel pass

Automated tests protect rules and obvious balance regressions. They cannot tell us whether the car is fun to drive. Before adding another major system, a human should be able to answer **yes** to most of the questions below after a few short races.

## 1. First 30 seconds

- Can a new player keep the car roughly on the circuit with WASD?
- Does steering feel immediate at low speed but require real braking at high speed?
- Does going wide cost time without making recovery miserable?
- Can every race action be reached comfortably with the left hand?
- Is it obvious that `1/2/3` are HARVEST / NORMAL / DEPLOY and `Q/E/R` are Soft / Medium / Hard?

If basic driving is frustrating, do not add more race systems. Fix handling first.

## 2. Racing another car

- Can the player deliberately place the car beside an AI rival?
- Does contact cost time without visible buzzing or repeated positional snapping?
- Does following feel different from clean air?
- Do AI cars actually leave the train and complete passes?
- Is the AI quick enough that NORMAL alone cannot simply drive away from the field?

The desired emotion is **“I can try that move again”**, not “the collision model cheated me”.

## 3. Tyres without staring at telemetry

Run one stint cleanly and one stint with repeated late braking / high-speed steering / wheel-to-wheel fighting.

- Does the harder-driven stint wear the tyre materially faster?
- Can the player feel weaker turn-in or longer braking before reading the wear number?
- Does Soft create obvious early pace while asking for an earlier stop?
- Does Hard sacrifice enough immediate grip to make its life advantage a real choice?
- Is the late-life cliff noticeable but recoverable?

If the tyre HUD can be hidden and the player still notices tyre state, the model is doing its job.

## 4. Strategy

Try at least these races:

- Soft → Medium
- Medium → Soft
- Medium → Hard
- an early stop
- a late stop

Ask:

- Did at least two approaches feel plausible before the result was known?
- Did traffic ever change the preferred pit timing?
- Did the two-compound obligation create a decision rather than paperwork?
- Was the late-race warning early enough to prevent a surprise DQ?

There should be no obvious “always choose this tyre and pit on this lap” answer.

## 5. Hybrid energy

- Does HARVEST visibly charge even while W remains held?
- Is HARVEST slow enough that leaving it on forever loses race time?
- Does NORMAL preserve energy well enough for ordinary keyboard driving?
- Does DEPLOY produce an obvious pass/defence opportunity?
- Does leaving DEPLOY on drain the battery quickly enough to be a bad default?
- At 0% charge, is the player clearly vulnerable to the AI on a straight?

If one of the three modes can be left on permanently with no meaningful downside, rebalance before adding more energy features.

## 6. One-more-race test

At the finish, the most important question is simple:

> Do I want to press C and try a different tyre, pit lap, hybrid plan, attack or driving line?

If yes, the core loop is working. If no, diagnose **driving feel, battles, tyre feedback or decision quality** before adding realism.

## Current non-goals

Do not use this playtest to request realism for its own sake. Fuel strategy, four-wheel tyre telemetry, full FIA penalties, safety cars, rain, damage, setup engineering and multiplayer remain deferred until the dry single-player race is consistently fun.
