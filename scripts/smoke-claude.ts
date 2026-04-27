import { askClaude } from "../lib/claude";

async function main() {
  console.log("ANTHROPIC_API_KEY set?", Boolean(process.env.ANTHROPIC_API_KEY));
  let sessionId: string | undefined;
  let text = "";
  for await (const ev of askClaude({
    content: [
      {
        type: "text",
        text: "Reply with exactly the single word: pong",
      },
    ],
  })) {
    if (ev.kind === "session") {
      sessionId = ev.sessionId;
      console.log("[session]", sessionId);
    } else if (ev.kind === "delta") {
      process.stdout.write(ev.text);
      text += ev.text;
    } else if (ev.kind === "done") {
      console.log("\n[done] assembled:", JSON.stringify(text));
      console.log("[done] fullText:", JSON.stringify(ev.fullText));
    } else if (ev.kind === "error") {
      console.error("\n[error]", ev.message);
      process.exit(1);
    }
  }
  if (!sessionId) {
    console.error("[FAIL] No session_id observed");
    process.exit(2);
  }
  console.log("[OK] sessionId:", sessionId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
