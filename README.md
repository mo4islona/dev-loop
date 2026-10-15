# dev-loop

A Claude Code skill that runs one coding task as a write → review → fix loop and learns,
from every decision you make, when it can stop asking you.

- **Writer**: a Claude subagent (default Opus, effort high). One per task; fix rounds go
  back to the same agent, so it keeps its reasons.
- **Reviewer**: Codex (default `gpt-6-astra`, reasoning high), read-only, structured output.
  A fresh thread every round, and every round hunts the whole change for new bugs, not only
  the last fixes.
- **Orchestrator**: the Claude session that runs the skill. It scores each finding, applies
  low-impact fixes on its own, and asks you about the rest.

Needless complexity counts as a defect. The reviewer is told what to look for, and it is
also told that it is a source of complexity itself: no "add a guard, a retry, a layer"
without a concrete failure.

## Install

    ln -s ~/Projects/dev-loop ~/.claude/skills/dev-loop

Then `/dev-loop <task>` in any repo. Override models for one run:
`/dev-loop writer=sonnet/medium reviewer=gpt-6-astra/xhigh <task>`.

## How it learns

Every finding and every decision goes to `~/.claude/dev-loop/ledger.jsonl`. Every 30 lines,
Retro reads `bin/stats` and proposes a diff to `profile.md`:

- an autonomy cell (category × fix risk) moves from `ask` to `auto` after 9 of your last 10
  decisions there were plain accepts, and back on your first veto;
- a kind of finding you keep rejecting becomes a "do not flag" rule for the reviewer;
- a kind you keep accepting becomes a writer rule, so it stops costing a round;
- a bug you find after the reviewer missed it becomes a "look for" rule.

Trust grows slowly and drops at once. Promotions and new rules wait for your "ok". A hard
floor (security, persistence, public API, concurrency, dependencies, config, test deletion)
always comes to you. Each rule list is capped, so the profile cannot grow into the
complexity it is meant to prevent.

## Files

| File | Who changes it |
|---|---|
| `SKILL.md` | you; Retro may propose edits |
| `settings.json` | you: default models and effort |
| `profile.md` | Retro and vetoes, committed here |
| `prompts/` | you |
| `review.schema.json` | the reviewer's output shape |
| `bin/snapshot` | tree hash of the working tree, without touching your index |
| `bin/review` | one Codex review round |
| `bin/stats` | ledger numbers and rule candidates for Retro |

Run state lives in `~/.claude/dev-loop/`, outside this repo, because it quotes code from
other repos. The orchestrator never commits in the task repo.
