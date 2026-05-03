# Restore focus to the PDF amber box after closing its thread

## Context

In `components/Reader.tsx`, two interactions can open a conversation thread:

1. **Thread-list item** — pressing Enter opens the thread; Esc closes it and correctly restores focus to the originating row.
2. **PDF amber-box pin** (`SelectionOverlay`) — pressing Enter opens the thread; Esc closes it but focus drops to `<body>` instead of the originating pin, breaking keyboard flow.

The list flow already works because `Reader` records the originating conversation in `threadListFocusConvIdRef` (`Reader.tsx:131`), passes it through `ConversationPanel` as `initialFocusConvId` (`Reader.tsx:1048`) and on to `ThreadList` as `focusConvId` (`ConversationPanel.tsx:1182`). When the panel re-mounts on close (its `key` flips to `"empty"`), `ThreadList`'s mount-effect refocuses the matching button (`ThreadList.tsx:305-315`).

`onPinClick` (`Reader.tsx:556-564`) has no equivalent — it calls `setActive(...)` without recording which pin opened the thread — and `onClose` is a bare `setActive(null)`.

## Change

`components/Reader.tsx` only. `SelectionOverlay` already gives us what we need: the pin button carries `data-pin-selection-id={p.selectionId}` (`SelectionOverlay.tsx:711`) and the primary pin is the only one with `tabIndex={0}` (`SelectionOverlay.tsx:710`), so a CSS selector resolves it uniquely.

1. Add a ref next to `threadListFocusConvIdRef`:
   ```ts
   const pinFocusSelectionIdRef = useRef<string | null>(null);
   ```

2. In `onPinClick`, record the originating pin and clear the list ref so the closing panel's `ThreadList` mount-effect won't steal focus:
   ```ts
   pinFocusSelectionIdRef.current = selectionId;
   threadListFocusConvIdRef.current = null;
   setActive({ kind: "existing", conversationId: convs[0].id });
   ```

3. In the inline `onOpenConversation` passed to `ConversationPanel`, clear the pin ref so a list-driven open won't restore to a stale pin:
   ```ts
   threadListFocusConvIdRef.current = conversationId;
   pinFocusSelectionIdRef.current = null;
   setActive({ kind: "existing", conversationId });
   ```

4. Replace the inline `onClose={() => setActive(null)}` with one that, after closing, focuses the originating pin if the pin ref was set:
   ```ts
   const sel = pinFocusSelectionIdRef.current;
   pinFocusSelectionIdRef.current = null;
   setActive(null);
   if (sel) {
     requestAnimationFrame(() => {
       const btn = document.querySelector<HTMLButtonElement>(
         `[data-pin-selection-id="${CSS.escape(sel)}"][tabindex="0"]`,
       );
       btn?.focus({ preventScroll: true });
     });
   }
   ```
   `requestAnimationFrame` lets React commit the `setActive(null)` re-render before we focus. Because we cleared `threadListFocusConvIdRef.current` on pin open, `ThreadList`'s mount-effect won't fight us.

Putting the restoration in `Reader` rather than `SelectionOverlay` matches how the list flow is already wired — `Reader` orchestrates `setActive`, so it's the natural place to decide where focus goes on close. `SelectionOverlay` doesn't re-mount across the open/close cycle, so a prop-driven mount-effect mirroring `ThreadList` wouldn't fire here without an extra trigger.

## Files to modify

- `components/Reader.tsx` — one new ref, three small handler edits.

## Verification

1. **Pin flow (the fix):** focus an amber box (Tab into the PDF or click), press Enter, press Esc → focus lands back on the same amber box. Try with both a single pin and a stack-overlap pin.
2. **List flow (regression check):** focus a thread-list row, press Enter, press Esc → focus lands back on the same row.
3. **Cross-flow:** open from list → Esc, then open from pin → Esc → focus on pin (not row). Reverse order → focus on row (not pin).
4. Type-check: `npx tsc --noEmit`.
