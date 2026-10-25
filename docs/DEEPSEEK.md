# DeepSeek Harness adapter (experimental shadow)

This branch adds a host-only DSH observer. It does not replace the stable CLI/SDK
algorithm, change the conversation, add model tools, or call a model. It emits
`agent-eta/update` with original/candidate/step-competitor forecasts and records
sanitized events under `.agent-eta/deepseek/`. The daily v0.12.0-deepseek.6 client adds a native input-dock status panel.

Verified controlled runtime: `@deepseek-ai/dsh-session@0.2.1-rc.2`,
`@deepseek-ai/cordis@4.0.5`. Actual SessionStore event publication plus actual
failing/fixed Node tests passed. This is not autonomous model accuracy evidence.

## Install the desktop preview

```sh
dsh plugin --profile desktop add 'github:maxi-max-dev/agent-eta#v0.12.0-deepseek.6' --ignore-scripts
```

If `dsh` is not on PATH on macOS, use the bundled launcher:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add 'github:maxi-max-dev/agent-eta#v0.12.0-deepseek.6' --ignore-scripts
```

Before restarting an idle app, choose a private absolute log directory in
`~/.dsh/profiles/desktop/cordis.patch.yml` (append, preserving existing settings):

```yaml
- id: agent-eta-deepseek-shadow
  config:
    journalDirectory: /absolute/private/eta-logs
```

Replace the example path with a writable directory. Without this override the
journal lives under `.agent-eta/deepseek` relative to the host working directory.
After restart: Plugins → agent-eta should be enabled; open an existing conversation
to see the input-dock panel. Toggle the plugin off to disable it; preserve logs.
Validated native desktop: 0.2.1-rc.3; isolated SessionStore fixture: 0.2.1-rc.2.
Other versions/platforms are not native UI compatibility claims.

## Opt-in loading

The package exports `agent-eta/deepseek` and includes a DSH bundle patch. Build a
local archive with `npm pack --pack-destination /absolute/output/directory`.
As of 2026-10-25, v0.12.0-deepseek.2 was installed offline using the bundled
`dsh plugin --profile desktop add` command. The native desktop plugin list shows
it enabled and its host PID wrote a readiness receipt. No paid task was sent.
Daily collection and evaluation limits: [daily protocol](DEEPSEEK-DAILY.md). The verified direct Cordis API is:

```js
import * as eta from 'agent-eta/deepseek';
await ctx.plugin(eta, {
  journalPath: '/absolute/path/to/a-new-eta-receipts.jsonl',
}).await();
ctx.on('agent-eta/update', prediction => { /* render/read experimental status */ });
```

`journalPath` must be a new file; omitted means a unique file beneath the current
working directory. `session/flush` drains the write queue. Fresh sessions require
no history query; resumed sessions require `ctx.sessionQuery.readSession()`.
Only the prefix before the current event is folded. Missing history/query or
invalid event sequences withdraw estimates. No deprecated synchronous event read.
Fork-inherited sessions are conservatively excluded. Currently history is held
in memory for sessions observed in this process, not restored from old receipts.
This makes restart a new cold start; it never silently pretends to retain history.

## Compare existing real logs without model spend

```sh
npm run evaluate:deepseek -- /absolute/path/to/.dsh/sessions /absolute/new/output
```

Requires Node >=22.13 and the `zstd` executable for compressed DSH logs. It reads
source sessions without changing them and saves text-free events, manifests,
outcomes, forecasts and a report. New output directory required; old runs cannot
be overwritten. Algorithm, split, scoring and caveats: [pilot protocol](DEEPSEEK-PILOT.md).

The local dataset may contain unrelated work rather than test-driven coding.
Unknown exit statuses are not passes. Failure/rework coverage zero means those
features are untested on real history, even when controlled integration passes.

## Reproduce the controlled host test

In a separate directory, install the two pinned runtime packages without scripts:

```sh
npm install --prefix /absolute/runtime --ignore-scripts --no-audit --no-fund \
  @deepseek-ai/cordis@4.0.5 @deepseek-ai/dsh-session@0.2.1-rc.2
node examples/deepseek-host-smoke.mjs /absolute/runtime /absolute/new/output
```

No API key required. A deliberate failing test is repaired deterministically;
the observer must see failure → edit/rework → passing test and both completed
steps. Test contents/output never enter the ETA journal. This fixture is not
counted among real model outcomes.

Native bash's durable message drops its canonical `exitCode` and normally stores
rendered stdout. The live adapter therefore also observes **`tools/result`**,
whose final `result.value` retains the foreground exit code. It never changes
that result or uses policy hooks. The controlled smoke emits this host hook from
actual subprocess results; it does not run the full native bash executor or an
autonomous model. Supplementary text-free receipts preserve failure/pass evidence
for future evaluation; old logs without that evidence remain unknown.

## Known limitations

- Experimental neighbour model and its intervals are uncalibrated; no promotion.
- Test recognition is intentionally narrow; shell-generated edits and arbitrary
  stdout are not inferred. Rework is an edit-after-failed-test proxy.
- Only explicit approval/ask-user waits can be subtracted. Unknown external waits
  remain part of observed duration. Never promise when a human will reply.
- Normal turn closure is not successful user acceptance. Cross-session histories
  use model/role cohorts, not inferred task descriptions.
- The vendored MIT step estimator is unchanged apart from TypeScript type erasure;
  its licence is retained. LLM PERT and self-reported ETA are not fabricated for
  comparison when no saved predictions exist.
