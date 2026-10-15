# dev-loop

dev-loop is a Claude Code skill that writes code with one model, reviews it with another,
and asks you only about the findings it can't safely settle on its own. Every answer you give
goes into a record, and the record decides what it may do without you next time. So it asks
less as it learns what you'd say.

## Why

Two things go wrong when you hand coding work to models.

First, you become the bottleneck. Every change waits for you to read a review, and most of
what you read is stuff you'd approve without thinking.

Second, both models add code. The writer adds a layer "for flexibility". The reviewer asks
for a null check, a retry, a cache, "just in case". The writer agrees, because writers
agree. After three rounds the code is twice the size and does the same thing.

dev-loop goes after both. It treats needless complexity as a defect, not a matter of taste,
and it tells the reviewer that the reviewer is a source of it too. And it hands work to
itself only as fast as your track record allows: trust grows after many agreements and
drops after one veto.

## Quick start

You need Claude Code, the Codex CLI (logged in), git and python3.

    git clone https://github.com/mo4islona/dev-loop ~/Projects/dev-loop
    ln -s ~/Projects/dev-loop ~/.claude/skills/dev-loop

Then, in any repo:

    /dev-loop add a timeout to the RPC client

To swap models for one run:

    /dev-loop writer=sonnet/medium reviewer=gpt-6-astra/xhigh add a timeout to the RPC client

## See the reviewer work

    demo/run

This builds a throwaway repo, drops in a small change with a wrong divisor and a class
hierarchy nobody needs, and runs two real review rounds against Codex. The second round
reviews a fix that brings in a new bug. It needs only the Codex CLI and takes a minute or
two. It doesn't run the writer: the change and the fix are files in `demo/`, so every run
has the same problems to find. (The reviewer's wording changes from run to run. It's a
model.)

Here's one run, unedited except for the temp path. The indented lines under each
`round` header are the live feed: they print while the reviewer works.

```
round 1: gpt-6-astra/high reads the change
  codex  I’ll check `sumPositive` and the existing tests, then verify the new function’s results and design.
  $ pwd; rg --files -g '!node_modules' -g '!target' -g '!package-lock.json' -g '!yarn.lock'
  $ cat avg.js sum.js
  $ node -e 'const {averagePositive}=require("./avg"); for (const xs of [[1,-1,3],[],[-1,-3],[0,2,4],[1,3]]) cons…
  $ git status --short; git ls-files; git log -1 --oneline
  think  Summarizing bug fixes and tests · Detailing code removals and additions
done in 32 s: verdict rethink, 2 findings

Round 1: verdict rethink, 2 findings
      Simpler shape: Implement averagePositive as one function: filter positive values,
      return 0 when none remain, otherwise divide sumPositive(positives) by
      positives.length. Keep sum.js unchanged and add assertions for both acceptance
      examples.

R1-1  The denominator breaks both acceptance cases
      bug, blocker · avg.js:12 · you decide: the fix changes behaviour
      Verified with Node: averagePositive([1, -1, 3]) returns 1.3333333333333333 instead of
      2 because xs.length includes negative values. averagePositive([]) returns NaN instead
      of 0 because it divides 0 by 0.
      Fix: Filter positive values, return 0 if their count is zero, and otherwise divide
      their sum by their count. Add regression assertions for both acceptance examples and
      an array containing zero.

R1-2  A strategy hierarchy obscures a single calculation
      complexity, major · avg.js:3 · you decide: the fix touches public_api
      Every ordinary call constructs PositiveAverageStrategy and forwards through compute.
      Readers must track a base class, an unimplemented method, inheritance, an injectable
      strategy parameter, and an unrelated null-input policy to understand one mean
      calculation.
      Fix: Delete both classes and the strategy parameter. Put the corrected calculation
      from R1-1 directly in averagePositive(xs), without the unrequested null/undefined
      branch. This preserves all required array behavior.

The human accepts R1-1 and rejects the rest as `later`. The writer applies a fix.

round 2: gpt-6-astra/high reads the change
  codex  I’ll check the applied fix, then trace the surrounding code and tests for regressions and missed
         bugs.
  $ pwd; rg --files -g '!node_modules' -g '!target' -g '!package-lock.json' -g '!yarn.lock'
  $ git status --short; nl -ba avg.js; nl -ba sum.js; git ls-files; node -e "const {averagePositive}=require('./a…
  think  Finalizing test findings
done in 22 s: verdict fix, 1 finding

Round 2: verdict fix, 1 finding

R2-1  Zero still counts toward the positive average
      bug, major · avg.js:12 · incomplete fix of R1-1 · you decide: the fix changes behaviour
      averagePositive([0, 2]) returns 1 instead of 2: the denominator includes zero, while
      sumPositive only includes values greater than zero. Both acceptance examples pass, but
      the promised regression assertions are absent.
      Fix: Change x >= 0 to x > 0. Add regression assertions for both acceptance examples
      and [0, 2], leaving sum.js unchanged.
```

Round 1 found both problems. It ran the code to prove the bug, and its `rethink` verdict
would put the hierarchy question to you before any small fix ran. Round 2 didn't stop at
checking the fix it asked for: it found that the fix counts zeros, tied that back to R1-1,
and left the rejected hierarchy finding alone.

Every item here goes to you, because each fix changes behaviour or the function's signature.
With the starting profile, only low-risk fixes run without you.

## The loop

```mermaid
flowchart TD
    brief[Brief] --> write[Writer: write the code]
    write --> tests{Tests green?}
    tests -- no --> write
    tests -- yes --> review[Reviewer: round k, fresh Codex thread]
    review --> triage[Orchestrator: score and route each finding]
    triage -- nothing left --> close[Close: summary, vetoes, misses]
    triage -- only auto items --> fix[Writer: apply fixes, run tests]
    triage -- items for you --> gate[Gate: you decide]
    gate --> fix
    fix --> stop{Stop rule hit?}
    stop -- no --> review
    stop -- yes --> close
    close --> ledger[(Ledger)]
    ledger --> retro[Retro: tune profile.md]
```

Four parties take part:

| Who | What runs it | Lifetime |
|---|---|---|
| Orchestrator | the Claude Code session where you typed `/dev-loop` | the task |
| Writer | a Claude subagent, Opus at high effort by default | one per task |
| Reviewer | Codex, `gpt-6-astra` at high reasoning by default, read-only | a new thread every round |
| You | the gate | only the findings routed to you |

The orchestrator writes no code. It frames the task, runs the other two, scores findings,
and keeps the record.

The writer lives for the whole task. Fix requests go back to the same agent, so it still
knows why it wrote what it wrote and can argue back.

The reviewer is the opposite: a new thread every round. A reviewer that remembers its last
round mostly checks its own old findings. A new one reads the change cold and finds what
the last one missed.

The writer and the reviewer are different models on purpose. A model reviewing code from
its own family tends to share that family's blind spots.

## One task, step by step

**1. Brief.** The orchestrator writes down the goal, the acceptance criteria as checkable
bullets, what's out of scope, the expected size (S, M or L) and the test command. It shows
you the brief only if it had to guess something.

**2. Write.** The writer gets the brief plus the rules it has learned from your past
reviews. It reports what it changed, what it assumed, and what it chose not to do. The
orchestrator then runs the tests itself. If they fail, the writer gets the output. After two
failed tries you get it.

**3. Review.** Codex reads the diff and the code around it, and returns findings as JSON:
category, severity, confidence, the concrete failure, the fix, and some facts about the fix
(lines it adds and removes, files it touches, whether callers see different behaviour,
which sensitive areas it touches).

A review takes a few minutes, and a silent wait that long looks like a hang. So you watch
it work: what the reviewer says and every command it runs come into the chat as they
happen.

    round 1: gpt-6-astra/high reads the change
      codex  I’ll check `sumPositive` and the existing tests, then verify the new function’s results and design.
      $ pwd; rg --files -g '!node_modules' -g '!target' -g '!package-lock.json' -g '!yarn.lock'
      $ cat avg.js sum.js
      $ node -e 'const {averagePositive}=require("./avg"); for (const xs of [[1,-1,3],[],[-1,-3],[0,2,4],[1,3]]) cons…
      $ git status --short; git ls-files; git log -1 --oneline
      think  Summarizing bug fixes and tests · Detailing code removals and additions
    done in 32 s: verdict rethink, 2 findings

**4. Triage.** The orchestrator reads the cited code and agrees or disagrees with each
finding. It drops nits and anything you've already rejected in this task. Then it routes the
rest, as described below.

**5. Gate.** If nothing needs you, you get one line ("Round 2: 3 auto-fixes, nothing for
you.") and the loop moves on. Otherwise you get a short block per item, problem first:

> **Round 2:** 2 for you, 1 auto-fix, 1 dropped
>
> **H1. Backoff never resets** · bug · `src/retry.ts:88`
> - Why: after one failure, every later retry waits 8 s, also after a success.
> - Fix: reset `delay` after a success. +1 −0, changes behaviour
> - Me: agree. I ran the retry test and saw the 8 s wait.
>
> **H2. A cache for a value read once** · complexity · `src/cache.ts`
> - Why: `loadConfig()` runs once per process, so the LRU cache never hits.
> - Fix: delete `cache.ts` and call `loadConfig()`. +2 −60, a large change
>
> **Auto:** A1 inline the one-use wrapper around `fetchAll` (`src/store.ts:40`, +3 −12).
> Auto-fixes run without a question; you can veto them at the end.

The headline is the problem in plain words, and `Why` is the input that breaks. The `Fix`
line ends with the fact that made the orchestrator ask you instead of fixing it alone. The
orchestrator adds a line of its own only when it has something to say: it disagrees, it
checked the numbers, or the fix has a cost.

Then you answer in Claude Code's picker, one tab per item. Each tab has four choices:
`Apply`, `Skip: later` (real, but out of scope), `Skip: over` (the fix adds complexity) and
`Skip: wrong` (not a real problem). The orchestrator's own pick comes first, marked
Recommended, so when you agree you press Enter. You can also type: an instruction changes
the fix, a sentence says why not, and `stop` ends the loop.

The skip reason is the most useful thing you give the loop. A `wrong` teaches the reviewer
what not to flag; an `over` teaches it which fixes cost more than they save.

**6. Fix.** The writer applies the auto items and the ones you accepted. It may refuse one
that it thinks is wrong. A refusal never turns into an auto-fix: it comes back to you with
both sides.

**7. Next round,** until a stop rule fires.

**8. Close.** You get what changed, one line per file; every auto-fix with the command that
reverts it; the open items; and a commit message draft. Then the picker asks two things:
which auto-fixes to veto, and whether the reviewer missed anything. dev-loop never commits.
You do.

## What the reviewer looks for

Round 1 reviews the whole change. Every later round does three jobs, in this order:

1. Check each fix from the last round. Is it right, and is it complete?
2. Look for bugs the fixes brought in.
3. Hunt the whole change for new bugs, as if nobody had reviewed it.

The third job is the one people skip. Reviews miss things, and a fix changes the code
around it. So every round starts the hunt over. Each finding says where it came from: `new`,
`missed`, `fix_regression` or `incomplete_fix`. That tells you whether the reviewer or the
writer is the weak spot.

Bugs need a concrete failure: these inputs, in this state, give this wrong result.

Complexity is counted in concepts, not lines: the types, layers, states, options and
indirections a reader has to hold in their head. Fewer lines isn't the goal. A dense
one-liner with a nested ternary is more complex than four plain lines. The reviewer flags,
for example:

- an interface, factory or strategy with one implementation;
- a wrapper that only forwards a call;
- an option or config key that only ever has one value;
- a null check on something that can't be null, or a catch that only logs and rethrows;
- a cache or flag where a local variable would do;
- code that rewrites something the language, a library or the repo already has;
- work the task didn't ask for.

Each complexity finding has to show the simpler version and say that it keeps the behaviour
the task needs.

Then the reviewer steps back and asks whether the whole task could be done with far fewer
moving parts. If yes, it says how and sets the verdict to `rethink`. You decide on that
before any small fix runs, because there's no point polishing code you might delete.

The reviewer also gets a rule against itself. It can't ask for more code without a
concrete failure. "What if X is null" when X can't be null isn't a finding. And a fix that
adds more lines than it removes has to fix a serious bug.

## How a finding gets routed

Each fix gets a risk, worked out from the reviewer's facts:

- **high**: it touches security, persistence, public API, concurrency, dependencies or
  config, or it deletes a test.
- **medium**: callers see different behaviour, or it touches more than one file, or it
  changes more than 30 lines.
- **low**: everything else.

The orchestrator can raise a risk after reading the code. It can't lower one.

The route comes from a table in `profile.md`. This is where it starts:

| category   | low  | medium |
|------------|------|--------|
| bug        | auto | ask    |
| complexity | auto | ask    |
| test       | auto | ask    |
| style      | auto | ask    |

High risk always goes to you. So does any finding the reviewer isn't sure about, any
finding the orchestrator disagrees with, any refusal from the writer, and any `rethink`.
Those rules are a hard floor that learning can't move.

## When the loop stops

The loop stops when:

- no finding survives triage;
- it reaches `max_rounds` (3 by default);
- the diff has grown in two fix rounds in a row;
- the same code has been changed one way and then back again;
- you say `stop`.

The growth rule is there because of the second problem from the top. If fix rounds keep
making the change bigger, the loop is probably adding complexity, not removing bugs. So it
stops and shows you, without starting another round.

## How it learns

Every finding and every decision is one line in `~/.claude/dev-loop/ledger.jsonl`. Each line
has a short label for the pattern, such as "one-use wrapper" or "null guard on non-null",
so similar findings can be counted together.

Every 30 lines, a step called Retro runs `bin/stats` and proposes one change to
`profile.md`:

- **More autonomy.** A route moves from `ask` to `auto` after you accepted at least 9 of its
  last 10 findings and vetoed none.
- **Less autonomy.** A route moves back to `ask` after 2 rejections or vetoes, and at once
  after any veto of an auto-fix.
- **Quieter reviewer.** A pattern you rejected 3 times for the same reason becomes a "do not
  flag" rule.
- **Sharper reviewer.** A bug you found twice after the reviewer missed it becomes a "look
  for" rule.
- **Better writer.** A pattern you accepted in 2 different tasks becomes a writer rule. Then
  the writer avoids it, and the next task doesn't spend a round on it.
- **Knobs.** If you keep stopping at round 2, it proposes `max_rounds: 2`.

Each rule list holds at most 15 rules, so the profile can't grow into the clutter it exists
to prevent. Moves toward caution apply on their own. Moves toward autonomy, new rules and
knob changes wait for your "ok". Retro commits what it changes, so `git log profile.md`
shows how the loop's rules changed and why.

`bin/stats` also prints the trend per task: the questions it asked you, auto-fixes, vetoes,
rounds, and findings you rejected as `wrong`. Questions per task should fall. Vetoes should
stay near zero. If they don't, the loop is learning the wrong thing, and the numbers tell
you before your code does.

## Settings and files

`settings.json` holds your defaults, the models and their effort. Retro never touches it.
`profile.md` holds what the loop has learned. Keeping them apart means a model choice never
gets "learned" away.

| File | What it is | Who changes it |
|---|---|---|
| `SKILL.md` | the procedure the orchestrator follows | you; Retro may propose edits |
| `settings.json` | default models and effort | you |
| `profile.md` | knobs, autonomy table, learned rules | Retro and vetoes |
| `prompts/writer.md`, `fix.md`, `reviewer.md` | what each model is told | you |
| `review.schema.json` | the shape of the reviewer's answer | you |
| `bin/snapshot` | a hash of the working tree | none |
| `bin/review` | runs one Codex review round and prints its live feed | none |
| `bin/feed` | turns Codex's event stream into that feed | none |
| `bin/stats` | ledger numbers and rule candidates | none |
| `demo/` | two review rounds on a seeded change | you |

## What it won't do

- It never commits, pushes or makes a worktree in your repo.
- The reviewer runs in a read-only sandbox.
- It cleans up after itself. Codex keeps no session files from the reviews, and a run's
  directory (prompts, diffs, raw reviews) is deleted after 14 days, about when git's own
  cleanup may drop the snapshot trees. The ledger stays: it's what the loop learns from.
- It never touches your git index, HEAD or branch. Snapshots are tree objects built from a
  throwaway index, and any auto-fix can be undone with `git diff <before> <after> | git apply -R`.
- Run state and the ledger live in `~/.claude/dev-loop/`, outside this repo, because they
  quote code from your other repos.

## Status

This is early. The snapshot, the review rounds and the stats have been tested, and
`demo/run` repeats the review test for anyone. A full loop with a real writer hasn't run
yet, so expect `SKILL.md` to change after the first real tasks.

The goal isn't a loop that never asks you anything. It's one that asks only the questions
your past answers can't settle.
