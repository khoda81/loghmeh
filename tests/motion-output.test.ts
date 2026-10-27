import { expect, test } from 'bun:test';
import { recoverClaudeHtml } from '../docs/design/motion/output.ts';

test('motion HTML is reconstructed when the final result contains only an output-limit continuation', () => {
  const first = '<!doctype html><html><style>body{border:1px sol';
  const last = 'id green}</style><body>Recovered</body></html>';
  expect(recoverClaudeHtml([
    { type: 'assistant', message: { content: [{ type: 'thinking' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: first }] } },
    { type: 'user' },
    { type: 'assistant', message: { content: [{ type: 'text', text: last }] } },
    { type: 'result', result: last },
  ])).toBe(first + last);
});

test('a complete final document wins, while incomplete output is not published', () => {
  const html = '<!doctype html><html><body>Complete</body></html>';
  expect(recoverClaudeHtml([{ type: 'result', result: '```html\n' + html + '\n```' }])).toBe(html);
  expect(recoverClaudeHtml([{ type: 'assistant', message: { content: [{ type: 'text', text: '<!doctype html><html>partial' }] } }])).toBeNull();
});
