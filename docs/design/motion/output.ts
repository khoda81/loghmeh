interface ClaudeEvent {
  type: string;
  result?: string;
  message?: { content?: Array<{ type: string; text?: string }> };
}

// Output-limit continuations can split HTML anywhere, including inside a CSS token.
// The result event may contain only the last continuation, rather than the whole answer.
export function recoverClaudeHtml(events: ClaudeEvent[]): string | null {
  const document = (text: string) => text.match(/<!doctype\s+html\b[\s\S]*?<\/html\s*>/iu)?.[0] ?? null;
  const results = events.filter(event => event.type === 'result' && typeof event.result === 'string');
  const finalDocument = document(results.at(-1)?.result ?? '');
  if (finalDocument) return finalDocument;
  const fragments = events.filter(event => event.type === 'assistant').flatMap(event =>
    (event.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? ''));
  return document(fragments.join(''));
}
