# Claude motion studies

This is a standalone design exploration, separate from the shipped extension.
The requested model is `claude-opus-5-5` with effort `high`. The brief requests
three interactive motion concepts and makes clear that authentication states
are simulated. Claude has no file-editing or network tools in this run.

Check the current job from the repository root:

```bash
cat outputs/motion/gallery-status.json
```

`state` is `running`, `complete`, or `failed`; `updatedAt` records the most recent
event. The thinking-token estimate is activity information, not a completion
percentage. A completed gallery is saved to `outputs/motion/gallery.html` and
to a timestamped file; raw events and errors are kept alongside it. Generated
results are ignored by version control until reviewed.

Serve the gallery and its existing local font/logo:

```bash
bun docs/design/motion/serve.ts
```

Open the printed localhost URL. While generating, it shows an honest waiting
page; after completion it shows the gallery. The study allows inline code
locally, with network connections blocked. The extension's policy is unaffected.

Start a new run only when needed (the interactive command waits until it finishes):

```bash
bun docs/design/motion/run.ts
```

The runner does not modify production code, create commits, or publish anything.
Review the generated concepts in the browser before adopting them.
