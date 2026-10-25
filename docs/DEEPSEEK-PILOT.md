# DeepSeek event-aware pilot v1 — frozen before outcome analysis

2026-10-25. Scope: current DSH turn ending normally, **not** successful human
acceptance or an entire project. Default Agent ETA remains unchanged. No paid
LLM calls, automatic background service, private text export, or public release.

## Sources and features

DSH `session/event`: turn/step start/end, request/context model, tool calls/results,
job settlements, approvals. In-memory command classification recognizes explicit
test invocations and known edit tools. No command/prompt/result body is persisted.
Test failure requires a recognized test call plus structured unsuccessful job or
tool result. No sentiment or arbitrary text scanning. An edit following a known
failed test is a **rework proxy**, not proof of the agent's intent. Unknown stays
unknown. Approval waits are excluded from active time; unknown waits cannot be
reconstructed. Seeded/forked histories and malformed lifecycles are excluded.

## Frozen candidate

Original: unchanged `forecastRun`, no plan, same model/role cohort, last 200 normal
completed turns visible at prediction time; >=3 required. Candidate uses the
same history. For each prior turn lasting longer than current active elapsed,
take its last structural snapshot at or before that elapsed time. Distance:
`abs(log((steps+1)/(pastSteps+1))) + .75*(phase differs)
 + .75*(unresolved test failure differs) + .5*(rework present differs)`.
Use nearest 7, at least 3. Empirical residual P20/P50/P80, interpolated quantiles,
blended in log space with original quantiles using n/(n+3). No tuned constants.
Too few survivors: fall back to original and report that fact. Intervals remain
uncalibrated. No plan/parallel credit enabled. A steps-only ablation uses only
the first distance term; it is diagnostic, not an extra promoted candidate.

## Competitors and comparison

Primary competitor is unchanged `etaCore` from dsh-session-turn-eta commit
b5cdc8ec7f51a3c882598fc7bc073f7c629f4a11 (MIT, attribution retained). Feed its
own-session history including non-success endings, preserving its semantics.
Its target is wall-time turn closure; scoring on normally ended no-wait turns
is the common target. Approval/ask-user turns are excluded from primary scores.
Secondary task-estimator heuristic is reported only as a reconstruction, not
an exact host projection benchmark. Model-reported ui-progress and LLM PERT
cannot be scored without historical reports; do not fabricate them or call
another model just to fill a cell.

## Real-history pilot (offline, not prospective)

Read existing local `.dsh/sessions/*.zstd` in memory. Persist only sanitized
structural events, aliases, file digests, forecast snapshots and aggregate data.
Group parent/subagent families together; first 60% of root families by creation
time are warm-up, final 40% held-out. Assignment uses metadata before outcomes.
All forecasts, including held-out, use only already-finished earlier turns and
events before each prediction; frozen online updating is allowed. Never tune on
held-out results. Fixed landmarks: 1/5/10 active minutes, one per turn per point.
Also report event-triggered signal coverage separately, never overweight it in
accuracy. Missing predictions/normal, failed, cancelled, unfinished, malformed,
wait-containing runs are reported. Primary comparison uses identical available
samples for original/candidate/competitor; report pairwise original/candidate too.
Run-level errors: MAE, median AE, severe underestimate (actual > 2*prediction),
P80 coverage, P20–P80 width, abstention, candidate-used count. Competitor IQR
range is not a P80. No causal online accuracy or independence claim for subagents.
No promotion from this exploratory retrospective pilot, even if its metrics win.
Existing future-evaluation gates remain in force for later real deployment.

## Host verification

Use isolated plugin context and real DSH/Cordis APIs where available; synthetic
lifecycle tests verify event contracts, not model performance. Existing desktop
profile and credentials remain unchanged. A fresh live-model cohort is separate
future work if offline evidence or access is insufficient, not silently simulated.
