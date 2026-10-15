# Fix round {{ROUND}}

Apply the findings below. Resolve each one with the smallest change, and touch nothing else.

If a finding is wrong, or its fix adds complexity with no real failure behind it, do not
apply it. Push back in one line instead; the human decides.

{{ITEMS}}
<!-- One line per item:
- [H1] src/retry.ts:88: backoff never resets. Fix: reset `delay` after a success. Human note: ... -->

Then run `{{TEST_CMD}}` and report one line per item, `applied` or `pushed back: <why>`,
followed by the test result.
