# Tighten line spacing in conversation bubbles & composer preview

## Context

Conversation thread bubbles (user / AI / memo) and the composer's live preview all render markdown through one shared component, `MathMarkdown` (`components/MathMarkdown.tsx:44`), which wraps the markdown in `prose prose-sm` from `@tailwindcss/typography`. The plugin's defaults are tuned for long-form articles, not chat:

- paragraph `line-height` ≈ **1.71**
- paragraph `margin-top` / `margin-bottom` ≈ **1.14em** (≈16px at the current font size)
- list item `line-height` ≈ 1.71, `ul`/`ol` margins ≈ 1.14em

That gives bubbles a loose, airy feel. The user has been on an active compaction pass (commits 392bc0a, f07d233, 58d1e6b, 8c16a97 all tighten paddings/margins around the composer and thread). This change is the next step: tighten the text spacing **inside** the bubble — both the within-paragraph line-height and the between-paragraph margins. The user confirmed they want both tightened.

## Approach

Extend the wrapper `className` in `MathMarkdown` with Tailwind Typography element modifiers. One change covers every consumer (user bubble, AI bubble, memo bubble, composer preview) because they all funnel through this component.

### Modifiers to add

| Concern | Modifier(s) | Effect |
|---|---|---|
| Within-paragraph line-height | `prose-p:leading-snug prose-li:leading-snug prose-headings:leading-snug` | ~1.71 → ~1.375 (lines wrap closer) |
| Between-paragraph margin | `prose-p:my-2` | per-side ≈16px → 8px |
| List block margin | `prose-ul:my-2 prose-ol:my-2` | per-side ≈16px → 8px |
| Per-list-item margin | `prose-li:my-0` | removes the small per-item top/bottom |
| Heading margin | `prose-headings:my-2` | tightens headings to match |

Code blocks (`pre`), tables, blockquotes, and Mermaid/KaTeX render are intentionally untouched — they aren't the source of the "loose" feel and tightening them risks readability.

## File to modify

- `components/MathMarkdown.tsx:44` — extend the wrapper `className`.

```tsx
// before
<div
  className="prose prose-sm max-w-none dark:prose-invert"
  style={fontSize ? { fontSize } : undefined}
>

// after
<div
  className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-snug prose-headings:my-2 prose-headings:leading-snug prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-snug"
  style={fontSize ? { fontSize } : undefined}
>
```

No new files, no global CSS, no per-call-site override. Single source of truth.

## Why here, not at each call site

Three call sites (`MessageBubble` user/AI at `components/ConversationPanel.tsx:2158`, memo at `:2134`, composer preview at `:1680`) already delegate prose styling to `MathMarkdown`. Changing the wrapper preserves that pattern; changing at the call sites would duplicate the modifier list three times and create drift risk later.

## Verification

1. `npm run dev`, open a conversation thread that contains a multi-paragraph AI reply (or send one).
2. Within a single wrapped paragraph: lines should sit visibly closer than before.
3. Between two paragraphs in the same bubble: the blank gap should be roughly half its previous height.
4. Lists (bulleted/numbered) inside an AI reply: items closer together, lists overall less padded.
5. Toggle the composer preview (the block at `ConversationPanel.tsx:1680`) and confirm it reflects the same tightening.
6. Open a memo (amber bubble) and confirm it tightens too.
7. Sanity: a fenced code block (` ``` `) inside a bubble still looks the same; a KaTeX `$$...$$` math block still renders normally; a Mermaid diagram still renders.
8. Print preview (`Cmd/Ctrl+P`) — no regression in the print stylesheet (it only targets `.rounded` page-break behavior).
