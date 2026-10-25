import { createHash } from 'node:crypto';

export const alias = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const testCommand = /^(?:(?:cd\s+[^;&|\n]+\s*&&\s*)?)(?:npm\s+(?:run\s+)?test(?:\s|$)|pnpm\s+(?:run\s+)?test(?:\s|$)|yarn\s+test(?:\s|$)|(?:python3?\s+-m\s+)?pytest(?:\s|$)|node\s+(?:--[\w=-]+\s+)*--test(?:\s|$)|go\s+test(?:\s|$)|cargo\s+test(?:\s|$)|(?:npx\s+)?(?:vitest|jest)(?:\s|$))/;

/** Deliberately conservative: generic Python/shell commands are not inferred edits. */
export function classifyTool(name, args = {}) {
  if (['ask_user_question'].includes(name)) return 'wait';
  if (['write', 'edit', 'str_replace_editor', 'apply_patch'].includes(name)) return 'edit';
  if (['read', 'read_image', 'web_search', 'web_fetch'].includes(name)) return 'inspect';
  if (name === 'bash' && typeof args.command === 'string' && testCommand.test(args.command.trim())) return 'test';
  return 'tool';
}

function exitCode(data) {
  // Only tool-owned structured envelopes; never scan arbitrary stdout for "failed".
  if (Number.isInteger(data.meta?.exitCode)) return data.meta.exitCode;
  for (const block of data.message?.content ?? []) {
    if (block.type !== 'text') continue;
    try {
      const result = JSON.parse(block.text);
      if (result.kind === 'foreground' && Number.isInteger(result.exitCode)
        && typeof result.stdout === 'object' && typeof result.stderr === 'object') return result.exitCode;
    } catch { /* Older plain stdout has unknown exit status. */ }
  }
  return null;
}

/** Input is untrusted host data; output is a text-free fixed vocabulary. */
export function normalizeEvent(event) {
  if (!event || !Number.isInteger(event.seq) || event.seq < 0 || !finite(event.time) || event.time < 0
    || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') throw new Error('INVALID_DSH_EVENT');
  const d = event.data;
  const e = { seq: event.seq, time: event.time, type: 'tick' };
  if (Number.isInteger(d.turn) && d.turn >= 0) e.turn = d.turn;
  if (Number.isInteger(d.step) && d.step >= 0) e.step = d.step;
  if (['turn/start','turn/end','step/start','step/end','assistant/message'].includes(event.type)) {
    e.type = event.type;
    if (e.turn === undefined || (event.type.startsWith('step/') && e.step === undefined)) throw new Error('INVALID_DSH_LIFECYCLE');
    if (e.type === 'turn/end') e.reason = ['completed','aborted','blocked','error','max-tokens','interrupted','forked'].includes(d.reason?.kind) ? d.reason.kind : 'unknown';
  } else if (event.type === 'request/context') {
    if(typeof d.provider!=='string'||typeof d.model!=='string'||!d.provider||!d.model)throw new Error('INVALID_DSH_MODEL');
    e.type = 'model'; e.model = alias(`${d.provider ?? ''}/${d.model ?? ''}`);
  } else if (event.type === 'tool/call') {
    if (typeof d.callId !== 'string') throw new Error('INVALID_DSH_CALL');
    let args = {}; try { args = JSON.parse(d.arguments) ?? {}; } catch { /* Unknown classification. */ }
    e.type = event.type; e.call = alias(d.callId); e.phase = classifyTool(d.name, args);
  } else if (event.type === 'tool/result') {
    if (typeof d.message?.toolCallId !== 'string') throw new Error('INVALID_DSH_RESULT');
    e.type = event.type; e.call = alias(d.message.toolCallId);
    const code = exitCode(d);
    e.outcome = code === 0 ? 'passed' : code !== null || d.message.isError === true ? 'failed' : 'unknown';
  } else if (event.type === 'job/settled' && d.toolCall?.callId) {
    e.type = event.type; e.call = alias(d.toolCall.callId);
    // A completed job does NOT prove exit code zero.
    e.outcome = d.status === 'failed' ? 'failed' : 'unknown';
  } else if (event.type === 'approval/asked' || event.type === 'approval/decided') {
    e.type = event.type; e.approval = alias(d.id);
  } else if (event.type === 'runtime/origin' && d.inherited === true) e.type = 'inherited';
  return e;
}
