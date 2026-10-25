# Daily shadow collection — frozen before activation, 2026-10-25

No added model/API calls, tools or prompts. Original/candidate/step comparator
are computed locally and recorded alongside structural events. No visible ETA
replacement. Parameters in DEEPSEEK-PILOT.md remain frozen.

Daily receipts use a configured absolute journalDirectory, a unique journal per
host mount and a .ready.json receipt. Restart is a new cold start (minimum three
completed same-model/role turns for original/candidate numbers). Historical
receipts remain intact. We do not present these mounts as one continuous cohort.
PTC child test/edit results are observed via the existing tools/result hook and
registered once when not present as a durable tool call. Their phase becomes
known at result time, not retrospectively at call start. Rework remains an
edit-after-failure proxy; a passing test resolves the proxy, not proof that every
failure in a project is fixed. Explicit tests only; arbitrary shell edits unknown.

Report using `node scripts/deepseek-shadow-report.mjs /absolute/journal-directory`.
Only saved forecasts are scored, never forecasts rerun with future data. Use
first available numeric prediction in [1,1.5), [5,5.5), [10,10.5) active minutes;
score against remaining active time at that prediction's actual timestamp.
No event in the window means abstention. Only observed start-to-end, valid,
completed, no-wait turns qualify. Cold starts/fallbacks, test failures and rework
counts are disclosed. Different mount partial turns are excluded. Report MAE
paired on identical turns; competitor zero/exhaustion disclosed separately.
This is descriptive personal-use data, not an independent benchmark or causal
proof. Review after at least 30 paired turns and 10 failure/rework turns as a
practical collection target (not a statistical power calculation). No auto-promotion.
Controlled fixtures are stored separately and never included in daily receipts.

Disable from DeepSeek Harness → Plugins → agent-eta toggle off; restart if the
client requests it. Keep receipts and profile backups. The observer is a bundle,
so removing only its config override does not disable it.

## Native panel (v0.12.0-deepseek.5)

The panel lives above the conversation input, via conversation.input.dock. The
host serves a read-only /agent-eta/status endpoint; a mounted panel polls every
2 seconds, stops on unmount, and marks disconnection instead of stale forecasts.
The SDK root exports are preserved; a root host mount is also exported because
DSH discovers client manifests only from bare package names, not subpaths.
Receipt counts survive restarts, but historical predictions never become live.
Current primary ETA remains the original algorithm; the candidate is labelled
experimental. Unknown/cold-start/waiting/invalid values are not invented.
The optional UI demo uses fixed, visibly labelled examples in React state only;
it never emits host events or writes to the collection journal. It is UI
acceptance, not an autonomous coding run or accuracy evidence.
