# Session load performance — plan

Why reopening a long session (~300k context) is slow, and the phased plan to fix it.

## Root cause

`session/load` is spec-defined to **stream the entire conversation history back as
`session/update` notifications** before resolving (ACP docs: "Loading Sessions").
There is no negotiated way to ask for less history:

- `devin acp` 3000.11.3 does **not** advertise `sessionCapabilities.resume`
  (`session/resume` resumes without replaying history) nor the Cognition meta caps
  `cognition.ai/tailReplay`, `cognition.ai/externalHistorySkeleton`,
  `cognition.ai/sessionSpine` — they exist in the binary but are not enabled.
  Session meta keys `cognition.ai/replayFrom` / `cognition.ai/loadId` /
  `cognition.ai/historySkeleton` suggest an incremental-replay design upstream.
- So the full replay is the protocol floor; only devin-pocket's own pipeline can be
  optimized locally.

## Measured volume on-device (sessions.db, proot)

| session         | message_nodes | payload | tool_call_state |
| --------------- | ------------- | ------- | --------------- |
| ninth-swordtail | 2052          | ~32 MB  | 473 (~2.2 MB)   |
| four-texture    | 1320          | ~13 MB  | 396 (~2.5 MB)   |
| flannel-myth    | 313           | ~2 MB   | 82              |

The largest nodes are ~1.2 MB base64 screenshots duplicated across context nodes.

## Amplifiers in devin-pocket

1. Server (`sessions.ts emitEvent`): every replayed notification → `applyEvent`
   (immutable copies; `appendText` does `last.text + text` → quadratic concat;
   `toolCallUpdate` does `findIndex` over all items) **and** one WS message per event.
2. Client (`store.ts`): every `session.event` → `applyEvent` again + `set()` →
   full Transcript re-render. `Item` is not memoized; `Markdown` re-runs
   `marked.parse` + `DOMPurify.sanitize` on every render.
3. `Chat.tsx` mounts `Transcript` as soon as `items.length > 0` even while
   `loading` → all renders happen during the flood.
4. After the replay, `open()` broadcasts a full `session.snapshot` — the whole
   state JSON a second time.
5. Termux/proot adds syscall overhead to the agent's SQLite reads and stdio;
   the phone CPU makes the JSON parse + render burst slower. Secondary factor.

## Options (what + cons)

1. **Suppress per-event broadcast while `loading`.**
   Server: `emitEvent` applies the reducer but skips the WS emit while
   `state.loading`; the final `session.snapshot` already replaces client state.
   Cons: no partial progress (not useful anyway); replayed perm requests would be
   hidden until the snapshot (unlikely); must guarantee snapshot on error (already
   in `finally`).
2. **Client renders skeleton for the whole `loading` window.**
   `Chat.tsx` gates on `state.loading` regardless of `items.length`.
   Cons: none meaningful; redundant with option 1 but cheap defense.
3. **`React.memo` on `Item` / `Markdown` / `ToolCard`.**
   Items are immutable in the reducer → reference-equality memo works; also speeds
   up live streaming, not just load. Cons: doesn't help the one big mount after the
   snapshot; tiny risk if anything ever mutates an item in place.
4. **Batch fold for replay (`applyEvents(state, events[])`).**
   Mutable builder, merge consecutive text chunks into one append — removes
   quadratic string concat and per-event array copies server-side.
   Cons: second code path that must stay in sync with `applyEvent` (needs
   equivalence tests); only helps the server once option 1 lands.
5. **Virtualize the transcript.**
   Render last K items + a top sentinel that expands on scroll-up. Only place that
   avoids parsing/mounting megabytes of markdown at once.
   Cons: find-in-page/screenshot miss off-DOM content; must integrate with
   tail-follow auto-scroll and scroll anchoring.
6. **Cap giant payloads during replay.**
   In `normalize.ts`, replace `image`/`resource`/`rawOutput` blocks above ~256 KB
   with a placeholder while loading.
   Cons: reload loses fidelity vs the live view (image/output no longer visible);
   no RPC to fetch a truncated block later; threshold is heuristic.
7. **Instrument the load.**
   Count updates/events and measure `loadSession` duration + pipeline time in
   `SessionManager.open()`; log it (`devin-pocket logs`). Optional: probe
   `_meta: { 'cognition.ai/loadStats': true }` on `session/load`; surface in
   Diagnostics. Cons: none.

## Phases

| Phase | Options | Rationale                                             |
| ----- | ------- | ----------------------------------------------------- |
| 1     | 7       | Cheap; tells us agent time vs our pipeline time.      |
| 2     | 1+2+3   | Cheapest high-impact: kills the WS flood + renders.   |
| 3     | 5       | If post-snapshot mount is still slow on 300k history. |
| 4     | 4, 6    | Only if measurements say so (server CPU / payload).   |

Do not apply all seven at once — protocol + reducer + UI churn makes regressions
hard to isolate. Phase 2 alone likely removes most of the pain. If phase 1 shows
the `await loadSession` dominates (agent serialization), the real fix is upstream
(`tailReplay`/`replayFrom`/`historySkeleton` or `session/resume` in `devin acp`).

## Log

- Phase 1 implemented: `session/load` stats logged from `SessionManager.open()`
  (`updates`, `events`, `pipelineMs`, `totalMs`).
