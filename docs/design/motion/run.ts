// Runs the user-requested Claude motion study independently of the chat/terminal.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

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
let buffered = '', result = '', assistantText = '', lastSave = 0, failed = false;
try {
  for await (const chunk of child.stdout) {
    log.write(chunk);
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      status.events++;
      status.updatedAt = new Date().toISOString();
      if (typeof event.estimated_tokens === 'number') status.estimatedThinkingTokens = event.estimated_tokens;
      if (event.type === 'assistant') assistantText += (event.message?.content ?? []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n');
      if (event.type === 'result') { result = event.result ?? ''; failed = Boolean(event.is_error); }
    }
    if (Date.now() - lastSave > 5000) { await saveStatus(); lastSave = Date.now(); }
  }
  const code = await child.exited;
  const html = (result || assistantText).match(/<!doctype html[\s\S]*<\/html>/iu)?.[0];
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
