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

**4. Triage.** The orchestrator reads the cited code and agrees or disagrees with each
finding. It drops nits and anything you've already rejected in this task. Then it routes the
rest, as described below.

**5. Gate.** If nothing needs you, you get one line ("round 2: 3 auto-fixes, nothing for
you") and the loop moves on. Otherwise you get one table:

    Round 2: 2 auto (applied with your reply), 2 for you, 1 dropped
    A1 auto complexity low  src/store.ts:40  one-use wrapper around fetchAll (-12 +3)
    H1 ask  bug        med  src/retry.ts:88  backoff never resets; third retry waits 8 s
            fix: reset `delay` after a success          | orch: agree | origin: missed
    H2 ask  complexity med  src/cache.ts:1   LRU cache for a value read once per run
            fix: delete cache.ts, call loadConfig() (-60 +2) | orch: agree
    reply: ok | ok H1 | no H2 <why> | edit H2 <how> | veto A1 | stop

You answer in a line, joining parts with `;`, for example `ok H1; no H2 later`. The reason
after `no` is optional, but it's the most useful thing you can give the loop. Four short
tags cover most cases: `over` (the fix adds complexity), `wrong` (not a real problem),
`later` (real, but out of scope) and `taste`.

**6. Fix.** The writer applies the auto items and the ones you accepted. It may refuse one
that it thinks is wrong. A refusal never turns into an auto-fix: it comes back to you with
both sides.

**7. Next round,** until a stop rule fires.

**8. Close.** You get what changed, one line per file; every auto-fix with the command that
reverts it; the open items; and a commit message draft. Then one question: "Veto an
auto-fix? Did the reviewer miss anything?" dev-loop never commits. You do.

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
| `bin/review` | runs one Codex review round | none |
| `bin/stats` | ledger numbers and rule candidates | none |

## What it won't do

- It never commits, pushes or makes a worktree in your repo.
- The reviewer runs in a read-only sandbox.
- It never touches your git index, HEAD or branch. Snapshots are tree objects built from a
  throwaway index, and any auto-fix can be undone with `git diff <before> <after> | git apply -R`.
- Run state and the ledger live in `~/.claude/dev-loop/`, outside this repo, because they
  quote code from your other repos.

## Status

This is early. The snapshot, the review rounds and the stats have been tested; two review
rounds ran against a real Codex model. In round 1 the reviewer caught a wrong divisor and a
needless strategy class hierarchy, and said `rethink`. In round 2 it caught the bug that the
first fix brought in, and it didn't repeat the finding that had been rejected. A full loop
with a real writer hasn't run yet, so expect `SKILL.md` to change after the first real tasks.

The goal isn't a loop that never asks you anything. It's one that asks only the questions
your past answers can't settle.
