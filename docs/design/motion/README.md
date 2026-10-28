# Claude motion studies

This gallery is the standalone design exploration. Saffron Orbit is now also
adapted into the extension's connection card in
[`src/lib/saffron-orbit.ts`](../../../src/lib/saffron-orbit.ts) and
[`ConnectionMotion.svelte`](../../../src/planner/ConnectionMotion.svelte).
The production version follows real connection states, stops waiting/failure
loops after settling, respects visibility and reduced motion, and disposes its
observers, frames and timers on unmount. Its short success confirmation leaves
the planner usable. The other two concepts remain studies.

The requested model is `claude-opus-5-5` with effort `high`. The brief requests
three interactive motion concepts and makes clear that authentication states
are simulated. Claude has no file-editing or network tools in this run.

The original completed response is preserved in `studies.html`: Saffron Orbit,
Loom of Letters, and Week to Plate. It was recovered from two assistant text
fragments in `gallery-1793088720936.jsonl`; the final result event contained only
the second fragment. Recovery concatenates text without inserting characters,
because the split occurred inside the CSS word `solid`. The raw log and failed
status were preserved under `outputs/motion/`.

The preview serves the current `outputs/motion/gallery.html` when present and
falls back to the committed original. `/original.html` always serves that original.
These are the original concepts; the requested food-only rework is a separate
design pass, especially for Loom of Letters.

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

To view on another device on the same local network, bind the preview explicitly:

```bash
LOGHMEH_MOTION_HOST=0.0.0.0 bun docs/design/motion/serve.ts
```

Use this computer's Wi-Fi address and the printed port on the other device.
Only the gallery, job status, and its local font/logo are served.

Start a new run only when needed (the interactive command waits until it finishes):

```bash
bun docs/design/motion/run.ts
```

The runner does not modify production code, create commits, or publish anything.
Review the generated concepts in the browser before adopting them.
