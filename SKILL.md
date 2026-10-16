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
| Reviewer | `bin/review` → Codex with settings `reviewer`, read-only sandbox | one Codex thread for up to three rounds: later rounds resume it with the new diff and a new bug hunt; `bin/review` starts a new thread in rounds 4, 7, ..., so old findings do not anchor it |
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
1. Read `profile.md`. Delete the run directories and pane files older than 14 days:
   `find $STATE/runs $STATE/live -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +`. Git
   may prune the unreferenced snapshot trees after two weeks, so older revert commands are
   unreliable.
2. `mkdir -p $RUN && $SKILL/bin/snapshot > $RUN/T0`. T0 includes the human's uncommitted
   work, so every review sees only this task's change.
3. Write `$RUN/settings.json`: `settings.json` with this run's overrides from the
   arguments, `writer=<model>[/<effort>]` and `reviewer=<model>[/<effort>]`, for example
   `/dev-loop reviewer=gpt-6.1-sol/xhigh fix the retry backoff`. `bin/review` reads it.

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
2. Fill `$RUN/review-$k.md`: from `prompts/reviewer.md` in round 1, and from
   `prompts/reviewer-next.md` in later rounds, with the fixes applied in round k-1 and
   every finding the human rejected in this task.
3. Run `$SKILL/bin/review $RUN $k` with Bash `run_in_background: true`; a review takes
   minutes. The dev-loop pane shows the human what the reviewer says and runs, so say
   nothing until the notification that the review ended. The result is
   `$RUN/review-$k.json`; on failure read `$RUN/review-$k.log`.

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
With no `ask` items, write one line ("Round 2: 3 auto-fixes, nothing for you.") and go to
Fix. Otherwise show the round, then ask.

1. Write the round as Markdown in this shape, not as a code block or a padded table:

   ```markdown
   **Round 2:** 2 for you, 1 auto-fix, 1 dropped

   **H1. Retries wait 8 s even after a success** · bug · `src/retry.ts:88`
   - Why: the upload client retries failed requests with backoff. After one failure, the
     delay never resets, so every later retry waits 8 s.
   - If skipped: every upload after the first network error is 8 s slower, until restart.
   - Fix: reset `delay` after a success. +1 −0, changes behaviour
   - Me: agree. I ran the retry test and saw the 8 s wait.

   **H2. A cache for a value read once** · complexity · `src/cache.ts`
   - Why: `loadConfig()` runs once per process, so the LRU cache never hits.
   - If skipped: 60 lines that the next reader must understand, for no gain.
   - Fix: delete `cache.ts` and call `loadConfig()`. +2 −60, a large change

   **Auto:** A1 inline the one-use wrapper around `fetchAll` (`src/store.ts:40`, +3 −12).
   Auto-fixes run without a question; you can veto them at the end.
   ```

   - Write for a reader who has not seen this code. The headline says the visible effect
     in plain words, in eight words or fewer.
   - `Why:` says what the code is for, then the failure: these inputs give this wrong
     result. Use two sentences when one is not clear.
   - `If skipped:` is the reviewer's `impact`: who sees it, how often, how bad.
   - `Fix:` is the fix the writer gets if the human accepts. End it with the size and the
     fact that made the item an `ask`: changes behaviour, touches 3 files, touches the
     public API, low confidence. When you disagree with the reviewer's fix, put your fix
     here and the reviewer's fix with your reason in `Me:`.
   - Write `Me:` only when it adds something: a disagreement, a check you made, a cost.
   - Leave out route, risk, confidence and origin; they go to the ledger. Name the origin
     only when a fix brought the problem in.

2. Ask with `AskUserQuestion`, one question per item, at most four per call; ask again for
   the rest.
   - `header`: the item id. `question`: the headline and the failure in one sentence.
   - Options: `Apply` (description: the fix and its size), `Skip: later` (real, but out
     of scope), `Skip: not worth it` (tag `over`: the fix costs more than the problem),
     `Skip: wrong` (not a real problem). Put your pick first and add "(Recommended)" to
     its label.
   - Give every option the same `preview`, so the detail panel stays open: the code at
     the cited line as it is now (about 12 lines, with line numbers, the line marked), then
     the reviewer's `fix_sketch` as a diff.
   - The human's own text is `?` (explain more), an edit to the fix, a reason to skip, or
     `stop`. Say so in the line before the call. On `?`, explain the item in full: what
     the code does, the path to the failure, what the fix changes, what a skip costs. Then
     ask about that item again.

3. For the verdict `rethink`, ask that question alone and first. Options: `Rework` to the
   simpler shape, `Keep this approach`, `Stop`. Put `simplest_alternative` in full in the
   `Rework` preview.

Log `Apply` as `accepted` and `Skip: <tag>` as `rejected` with the tag. Log the human's own
text as `edited` when it changes the fix, and as `rejected` with that text as the reason
when it says why not. The reason is the strongest learning signal, so the skip options carry
one.

Without `AskUserQuestion`, for example in a headless run, end the Markdown with
`**My pick:** <reply>` and take a reply in this grammar, parts joined with `;`: `ok` (take
the pick), `ok H1 H3` (accept these, reject the others), `no H2 <reason>`,
`edit H2 <instruction>`, `veto A1`, `stop`.

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

Delete the reviewer's Codex sessions, which hold the task's code:
`while read -r t; do find "${CODEX_HOME:-$HOME/.codex}/sessions" -name "*$t.jsonl" -delete; done < $RUN/threads`.

Do not commit. Ask once with `AskUserQuestion`: "Veto an auto-fix?" (multi-select: `Keep
all` and the auto-fixes, at most four) and "Did the reviewer miss anything?" (`No`, or the
human's own text). Log a veto as `vetoed` (a new line, same id) and a miss as
`human_found`. A veto sets its autonomy cell back to `ask` in `profile.md` at once; Retro
may promote it again later.

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
     "writer":"opus/high","reviewer":"gpt-6.1-sol/high"}

One JSON object per line. `decision` is one of `applied` (auto), `accepted`, `edited`,
`rejected`, `vetoed`, `dropped`, `pushed_back`, `human_found`. `kind` is a 2-6 word label
of the pattern, such as "one-use wrapper" or "null guard on non-null". Retro groups by it,
so reuse a label from `bin/stats kinds` when one fits.

## Hard limits
- Never commit, push or make a worktree in the task repo. The human commits.
- Retro cannot change the hard floor in `profile.md`.
