# claude-wa

A lightweight WhatsApp-to-Claude Code bridge. Message yourself on WhatsApp, get Claude Code responses back. No API costs, no third-party harnesses. ~200 lines of code.

## Why

If you just want to talk to Claude Code from your phone, most solutions are overkill. claude-wa is a thin pipe between WhatsApp and `claude -p`. It uses your existing Claude Max/Pro subscription through the official CLI. Nothing spoofed, nothing proxied.

## Quickstart

```bash
git clone https://github.com/yourusername/claude-wa.git
cd claude-wa
npm install
cp config.example.json config.json
# Edit config.json with your phone number (with country code, no +)
node bridge.js
# Scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device
# Send yourself a message — Claude responds
```

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- WhatsApp account

## How It Works

```
Your Phone (WhatsApp)
       ↕
  Baileys (WebSocket — no browser needed, ~50MB RAM)
       ↕
  bridge.js
       ↕
  claude -p "your message" --output-format json
       ↕
  Response sent back to WhatsApp
```

Baileys links as a "Linked Device" on your existing WhatsApp account — same as WhatsApp Web. You message your own number (or use WhatsApp's "Message Yourself" feature). The bridge sees it and responds in the same chat.

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "phone": "15551234567",
  "cwd": "~/my-project",
  "allowedTools": ["Bash", "Read", "Write", "Edit"],
  "skill": null,
  "maxTurns": null,
  "timeout": 300000
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `phone` | ✅ | Your phone number with country code, without `+`. Example: `15551234567` for US. Used as allowlist — bot ignores everyone else. |
| `cwd` | ❌ | Working directory for Claude Code. Defaults to `~`. Claude runs here and has access to files in this directory. |
| `allowedTools` | ❌ | Tools Claude can use without permission prompts. Defaults to `["Bash", "Read", "Write", "Edit"]`. |
| `skill` | ❌ | Path to a skill markdown file. Its contents get injected via `--append-system-prompt` on every call. |
| `maxTurns` | ❌ | Limit Claude's agentic loops per message. Useful for keeping costs predictable. |
| `timeout` | ❌ | Max time per Claude invocation in ms. Default: 300000 (5 min). |

## Skills

A skill is just a markdown file with instructions for Claude. Drop it anywhere and point `config.json` at it:

```json
{
  "skill": "./skills/my-workflow.md"
}
```

The contents get appended to Claude's system prompt on every invocation. This is how you customize behavior without touching bridge code.

### Example: Daily standup summary

```markdown
You help me write daily standup updates.
When I describe what I worked on, format it as:

**Yesterday:** [what I did]
**Today:** [what I plan to do]
**Blockers:** [any blockers, or "None"]

Keep it concise. No fluff.
```

### Example: Code review helper

```markdown
You are a code reviewer. When I share code or diffs:
1. Check for bugs, security issues, and performance problems
2. Suggest improvements
3. Be direct — no "great job" filler

If I say "review PR [number]", use gh CLI to fetch the diff.
```

## Sending Images

If Claude Code generates files (screenshots, exports, etc.), you can send them back through WhatsApp. The bridge watches Claude's output for file paths and sends them as media.

If Claude's response contains a line like `[IMAGE: /path/to/file.png]`, the bridge sends it as a WhatsApp image. This is opt-in — Claude needs to output that tag, which you configure in your skill.

## Running in Background

```bash
nohup node bridge.js > bridge.log 2>&1 &
```

Or use pm2:

```bash
npm install -g pm2
pm2 start bridge.js --name claude-wa
pm2 logs claude-wa
```

## Project Structure

```
claude-wa/
├── bridge.js              # Entry point — WhatsApp ↔ Claude Code
├── lib/
│   ├── whatsapp.js        # Baileys connection, auth, message handling
│   ├── claude.js          # claude -p wrapper with config
│   └── media.js           # Image/file sending helpers
├── config.example.json    # Template config
├── skills/                # Example skills (not loaded by default)
│   └── example.md
├── auth/                  # Auto-created on first QR scan (gitignored)
├── package.json
└── README.md
```

## Troubleshooting

### QR code won't scan / 405 error
Delete the `auth/` folder and restart. The bridge uses `fetchLatestBaileysVersion()` to get the correct WhatsApp version.

### "Cannot link device" with pairing code
Use QR code scanning instead — it's more reliable for initial pairing.

### Messages not coming through
- Make sure your phone number in config.json includes country code (e.g., `1` for US)
- Check you're messaging yourself, not someone else
- The bridge only responds to messages from the configured phone number

### Claude hangs / no response
The CLI runs with `CI=true` to disable interactive prompts. If still hanging, check that `claude` CLI works standalone:
```bash
claude -p "hello" --output-format json
```

## Testing

Once running, send these from WhatsApp:

1. `hello` — should get a Claude response back
2. `what directory are you running in?` — confirms cwd is set correctly
3. `ls` — confirms Bash tool is allowed
4. `read package.json and tell me the name field` — confirms Read tool works

## License

MIT
