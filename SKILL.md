---
name: dev-loop
description: Run one coding task as a loop. An Opus writer implements it; a Codex reviewer hunts bugs and needless complexity in every round; the orchestrator scores each finding, applies low-impact fixes on its own and asks the human about the rest; every human decision tunes the profile so the human is asked less over time. Use for "/dev-loop <task>".
disable-model-invocation: true
---

# dev-loop

You are the orchestrator. You do not write the task's code. You frame the task, run the
writer and the reviewer, score findings, ask the human only what the profile routes to
them, log every decision, and keep `profile.md` current.

## Roles

| Role | Runs as | Lifetime |
|---|---|---|
| Orchestrator | this session | the task |
| Writer | `Agent` with `model` and `effort` from settings `writer`, prompt from `prompts/writer.md` | one per task; fix rounds go to the same agent through `SendMessage`, so it keeps its reasons |
| Reviewer | `bin/review` → Codex with settings `reviewer`, read-only sandbox | a fresh thread every round: a resumed thread checks its own old findings and stops hunting |
| Human | the gate | decides every finding the profile routes to `ask` |

## Paths

- `SKILL`: this directory. Prompts, schema, scripts and `profile.md` live here, under git.
- `SKILL/settings.json`: the human's defaults: writer `model` (an `Agent` model name:
  `opus`, `sonnet`, `haiku`, `fable`) and `effort`; reviewer Codex `model` and `effort`.
  Retro never changes this file.
- `STATE=~/.claude/dev-loop`. `RUN=$STATE/runs/<task-id>`, where task-id is `YYYYMMDD-HHMM-<slug>`.
- `$STATE/ledger.jsonl`: one line per finding and decision, for all tasks. It is the only
  training data, so append only. It stays outside the repo because it quotes private code.

Run every `bin/` script from the task repo's root.

## Procedure

### 0. Start
1. Read `profile.md`.
2. `mkdir -p $RUN && $SKILL/bin/snapshot > $RUN/T0`. T0 includes the human's uncommitted
   work, so every review sees only this task's change.
3. Write `$RUN/settings.json`: `settings.json` with this run's overrides from the
   arguments, `writer=<model>[/<effort>]` and `reviewer=<model>[/<effort>]`, for example
   `/dev-loop reviewer=gpt-6-astra/xhigh fix the retry backoff`. `bin/review` reads it.

### 1. Brief
Write `$RUN/brief.md`:

    Goal: one or two sentences
    Acceptance: checkable bullets
    Out of scope: what a reasonable writer might do but must not
    Expected size: S (<50 changed lines) | M (<200) | L
    Test command: found in package.json, Makefile, Cargo.toml or CI config

`confirm_brief` decides whether you show the brief and wait for "ok". With
`when-ambiguous`, wait only when you had to guess the goal or an acceptance item.

### 2. Write
Launch the writer with `prompts/writer.md`, filled from the brief and the profile's writer
rules. When it returns, run the test command yourself. On red, send the output back to the
writer; after two red tries, stop and show the human.

### 3. Review round k (k = 1, 2, ...)
1. `$SKILL/bin/snapshot > $RUN/T$k`.
2. Fill `prompts/reviewer.md` into `$RUN/review-$k.md`. From round 2 on, the round context
   lists the fixes applied in round k-1 and every finding the human rejected in this task.
3. `$SKILL/bin/review $RUN $k` with `run_in_background: true`; a review takes minutes. The
   result is `$RUN/review-$k.json`; on failure read `$RUN/review-$k.log`.

Every round hunts for new bugs in the whole change, not only in the fixes. The reviewer
reports each finding's `origin`: `new` (round 1), `missed` (earlier rounds did not see it),
`fix_regression` (a fix brought it in) or `incomplete_fix`.

### 4. Triage
For each finding:
1. Drop it (log `dropped`) when its severity is `nit`, or it repeats a finding the human
   rejected in this task.
2. Read the cited code. Record `orch: agree` or `orch: disagree <one line>`.
3. Set the fix risk:
   - `high`: `touches` is not empty.
   - `medium`: `changes_behavior`, or `files_touched` > 1, or `adds_lines + removes_lines` > 30.
   - `low`: everything else.

   You may raise a risk after you read the code. Never lower it.
4. Route = the profile's autonomy cell for (category, risk). `high` is always `ask`.
   Turn `auto` into `ask` when confidence is not `high`, when you disagree, or when the
   same spot has a `fix_regression` for the second time.
5. Verdict `rethink`: put one `ask` item for the whole approach first, quote
   `simplest_alternative` in full, and hold the other findings until the human answers.

### 5. Gate
With no `ask` items, write one line ("round 2: 3 auto-fixes, nothing for you") and go to
Fix. Otherwise show one table and stop:

    Round 2: 2 auto (applied with your reply), 2 for you, 1 dropped
    A1 auto complexity low  src/store.ts:40  one-use wrapper around fetchAll (-12 +3)
    H1 ask  bug        med  src/retry.ts:88  backoff never resets; third retry waits 8 s
            fix: reset `delay` after a success          | orch: agree | origin: missed
    H2 ask  complexity med  src/cache.ts:1   LRU cache for a value read once per run
            fix: delete cache.ts, call loadConfig() (-60 +2) | orch: agree
    reply: ok | ok H1 | no H2 <why> | edit H2 <how> | veto A1 | stop

Reply grammar, parts joined with `;`:
- `ok`: accept all. `ok H1 H3`: accept these, reject the others with no reason.
- `no H2 <reason>`, `edit H2 <instruction>`, `veto A1`, `stop`.

The reason after `no` is optional, but it is the strongest learning signal. Offer the tags
`over` (the fix adds complexity), `wrong` (not a real problem), `later` (real, but out of
scope) and `taste`.

### 6. Fix
Send `prompts/fix.md` to the same writer with the auto, accepted and edited items. A
push-back from the writer becomes an `ask` item at the next gate, with both views. It is
never applied as an auto-fix. Run the tests as in step 2.

### 7. Log
Append one ledger line per finding with its final decision (format below).

### 8. Next round or stop
Stop when one of these holds:
- no finding survived triage (converged);
- k = `max_rounds`;
- the task diff (`git diff --shortstat <T0> <Tk>`) grew in two fix rounds in a row: the
  fixes add complexity. Say so;
- the same spot got opposite fixes in two rounds (oscillation): show both to the human;
- the human said `stop`.

Otherwise k += 1 and go to step 3.

### 9. Close
Show:
- what changed, one line per file;
- the rounds and the auto-applied fixes, each with its revert
  (`git diff <Ta> <Tb> | git apply -R`);
- the open items;
- a commit message draft in the human's style.

Do not commit. Ask once: "Veto an auto-fix? Did the reviewer miss anything?" Log a veto as
`vetoed` (a new line, same id) and a miss as `human_found`. A veto sets its autonomy cell
back to `ask` in `profile.md` at once; Retro may promote it again later.

### 10. Retro
Run `$SKILL/bin/stats`. When the ledger lines since the last retro reach `retro_every`,
propose one diff to `profile.md`:
- Promote a cell to `auto` when its last 10 human decisions have 9 or more `accepted` and
  no veto (`bin/stats` hint `promote`).
- Demote an `auto` cell with 2 or more rejections or vetoes in that window.
- Add a "do not flag" rule when one kind is rejected 3 or more times with one reason.
- Add a "look for" rule when one kind is `human_found` 2 or more times.
- Add a writer rule when one kind is accepted or applied in 2 or more tasks, so the writer
  avoids it and the next task costs no round for it.
- Change a knob when the human keeps overriding it, for example `stop` at round 2 three
  times: `max_rounds: 2`.
- Each rule list holds at most 15 rules. On overflow, propose which rule to drop.

Apply demotions without asking. Promotions, new rules and knob changes need the human's
"ok". Then set `last_retro`, commit in `SKILL` (`profile: <what changed>`), and show the
trend from `bin/stats`: decisions asked and auto-applied per task, vetoes, rounds, and the
reviewer noise (`wrong` rejections). You may propose changes to this file; apply them only
after the human says yes.

## Ledger line

    {"ts":"2026-10-15T14:02:00Z","repo":"my-api","task":"20261015-1402-retry-backoff",
     "round":2,"id":"H1","category":"bug","severity":"major","confidence":"high",
     "origin":"missed","risk":"medium","route":"ask","orch":"agree","decision":"accepted",
     "reason":"","kind":"backoff not reset","file":"src/retry.ts",
     "writer":"opus/high","reviewer":"gpt-6-astra/high"}

One JSON object per line. `decision` is one of `applied` (auto), `accepted`, `edited`,
`rejected`, `vetoed`, `dropped`, `pushed_back`, `human_found`. `kind` is a 2-6 word label
of the pattern, such as "one-use wrapper" or "null guard on non-null". Retro groups by it,
so reuse a label from `bin/stats kinds` when one fits.

## Hard limits
- Never commit, push or make a worktree in the task repo. The human commits.
- Retro cannot change the hard floor in `profile.md`.
