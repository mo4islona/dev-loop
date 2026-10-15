# dev-loop profile

The orchestrator changes this file only in Retro or after a veto (SKILL.md, steps 9-10).
Keep it under 80 lines: a profile that grows without limit becomes the complexity it fights.

last_retro: 2026-10-15 (ledger lines: 0)

## Knobs
- confirm_brief: when-ambiguous   (always | when-ambiguous | never)
- max_rounds: 3
- retro_every: 30   (ledger lines)

## Autonomy
The route for a finding by its category and fix risk. `high` risk is always `ask`.

| category   | low  | medium |
|------------|------|--------|
| bug        | auto | ask    |
| complexity | auto | ask    |
| test       | auto | ask    |
| style      | auto | ask    |

Hard floor, which Retro cannot change: a finding is `ask` when it touches security,
persistence, schema or migrations, public API or wire format, concurrency, dependencies,
config, or deletes a test; when the writer pushed back; when the orchestrator disagrees;
when the reviewer verdict is `rethink`.

## Writer rules
From findings accepted in two or more tasks. Format: `- rule [n=<evidence>, since=<date>]`.
- (none yet)

## Reviewer: do not flag
From findings the human rejected three or more times for one reason.
- (none yet)

## Reviewer: look for
From issues the human found after the reviewer missed them.
- (none yet)
