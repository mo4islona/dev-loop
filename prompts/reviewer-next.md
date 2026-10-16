# Round {{ROUND}}

The writer changed the code since the last round; <delta_diff> at the end holds that
change. The files on disk are current. If you read files in an earlier round, those reads
are stale, so read a file again before you cite it.

The writer applied these fixes:
{{APPLIED}}

The human rejected these findings. Do not report them again, in any wording:
{{REJECTED}}

All other findings from earlier rounds are decided. Report only what is new, numbered
R{{ROUND}}-1, R{{ROUND}}-2 and so on.

Do all three, in this order:
1. Check each applied fix. Is it correct and complete? For an incomplete fix, report a
   finding with origin `incomplete_fix` and `prior_id` set to the fix's id.
2. Hunt for bugs that the fixes brought in. Read the code around them as well. Origin
   `fix_regression`.
3. Hunt for new bugs across the whole change, as if no one had reviewed it. Earlier rounds
   missed things, so do not stop at the fixes. Origin `missed`.

The rules from the first prompt still apply.
