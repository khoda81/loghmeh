// Runs the user-requested Claude motion study independently of the chat/terminal.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { recoverClaudeHtml } from '../../../scripts/claude-output.ts';

const root = path.resolve(import.meta.dir, '../../..');
const directory = path.join(root, 'outputs/motion');
await mkdir(directory, { recursive: true });
const stamp = Date.now();
const statusPath = path.join(directory, 'gallery-status.json');
const logPath = path.join(directory, `gallery-${stamp}.jsonl`);
const outputPath = path.join(directory, `gallery-${stamp}.html`);
const status = {
  state: 'running', model: 'claude-opus-5-5', effort: 'high', pid: process.pid,
  startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  events: 0, estimatedThinkingTokens: 0, outputPath, logPath, error: '',
};
const saveStatus = () => Bun.write(statusPath, JSON.stringify(status, null, 2) + '\n');
await saveStatus();
const child = Bun.spawn(['claude', '-p', '--safe-mode', '--model', status.model, '--effort', status.effort,
  '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-chrome',
  '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], {
  cwd: root, stdin: Bun.file(path.join(import.meta.dir, 'brief.txt')), stdout: 'pipe',
  stderr: Bun.file(path.join(directory, `gallery-${stamp}.stderr.log`)),
  env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: 'high' },
});
const log = Bun.file(logPath).writer();
const decoder = new TextDecoder();
let buffered = '', lastSave = 0, failed = false;
const events: Parameters<typeof recoverClaudeHtml>[0] = [];
function consume(line: string) {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  status.events++;
  status.updatedAt = new Date().toISOString();
  if (typeof event.estimated_tokens === 'number') status.estimatedThinkingTokens = event.estimated_tokens;
  if (event.type === 'assistant' || event.type === 'result') events.push(event);
  if (event.type === 'result') failed = Boolean(event.is_error);
}
try {
  for await (const chunk of child.stdout) {
    log.write(chunk);
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop()!;
    for (const line of lines) consume(line);
    if (Date.now() - lastSave > 5000) { await saveStatus(); lastSave = Date.now(); }
  }
  consume(buffered + decoder.decode());
  const code = await child.exited;
  const html = recoverClaudeHtml(events);
  if (code !== 0 || failed || !html) throw new Error(`Claude exited with code ${code}; no complete HTML gallery was returned. See ${logPath}`);
  await Bun.write(outputPath, html + '\n');
  await Bun.write(path.join(directory, 'gallery.html'), html + '\n');
  status.state = 'complete';
} catch (error) {
  status.state = 'failed';
  status.error = error instanceof Error ? error.message : 'The motion study did not complete.';
} finally {
  await log.end();
  status.updatedAt = new Date().toISOString();
  await saveStatus();
}
