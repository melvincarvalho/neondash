# The prompt

Fourth game in the harsh-critic-loop series (after
[NEONOID](https://github.com/melvincarvalho/neonoid),
[NEON MINER](https://github.com/melvincarvalho/neonminer) and
[NEODROID](https://github.com/melvincarvalho/neodroid)). The new discipline:
cellular physics — the whole game is one emergent system, so the harness can
prove things about it.

```
Build a Boulder Dash tribute at the level of a modern commercial retro remake.
Single-file browser game, zero assets. Original caves and character — Otto
from NEON MINER returns as the digger. Authentic 1984 rules: scan-order cell
physics, boulders that roll off rounded objects, push-with-delay, fireflies
and butterflies with wall-following patrols, butterflies blooming into
diamonds when crushed, quota-opens-exit, a ticking cave timer.

One owner writes the whole game. Then /loop harsh sub-agent critics: the
three visual lenses plus a BOULDER DASH FIDELITY critic who verifies the
physics from a deterministic tick-by-tick capture strip (one boulder drops,
lands on another, rolls off — reconstructed frame by frame).

The harness must include a SOLVABILITY BOT: every cave must be cleared
headlessly by the bot before any critic sees a pixel, with JSON telemetry
per cave. An unsolvable cave is a build failure, not a critique. Grade
against the commercial bar, call out fixes that didn't land, loop until
plateau, report the honest number.
```
