# Pitwall Racer — Manual Playtest Gate

Automated tests protect rules and obvious balance regressions. They cannot tell us whether the car is fun to drive. Before adding another major system, a human should be able to answer **yes** to most of the questions below after a few short races.

## 1. First 30 seconds

- Can a new player keep the car roughly on the circuit with WASD?
- Does steering feel immediate without becoming twitchy at speed?
- Does going wide cost time without making recovery miserable?
- Is it obvious what `1/2/3`, `4/5/6`, `Space` and `P` do from the HUD?

If basic driving is frustrating, do not add more race systems. Fix handling first.

## 2. Racing another car

- Can the player deliberately place the car beside an AI rival?
- Does contact cost time without instantly ruining the race?
- Does following feel different from clean air?
- Does OVERTAKE create a satisfying pass opportunity rather than acting as a permanent extra throttle button?

The desired emotion is **“I can try that move again”**, not “the collision model cheated me”.

## 3. Tyres without staring at telemetry

Run one stint mostly BALANCED and one stint mostly PUSH.

- Is PUSH immediately useful?
- After repeated PUSH laps, can the player feel weaker turn-in or longer braking before reading the wear number?
- Can CONSERVE rescue a tyre without becoming boring waiting?
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

## 5. Energy

- Is holding OVERTAKE everywhere clearly wasteful?
- Is saving charge for a straight or pass visibly useful?
- Does braking/harvesting make the next deployment feel earned?

If the player holds Space by default, rebalance before adding more energy features.

## 6. One-more-race test

At the finish, the most important question is simple:

> Do I want to press R and try a different tyre, pit lap, attack or driving line?

If yes, the core loop is working. If no, diagnose **driving feel, battles, tyre feedback or decision quality** before adding realism.

## Current non-goals

Do not use this playtest to request realism for its own sake. Fuel strategy, four-wheel tyre telemetry, full FIA penalties, safety cars, rain, damage, setup engineering and multiplayer remain deferred until the dry single-player race is consistently fun.
