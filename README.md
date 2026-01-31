# claude-wa

A lightweight WhatsApp-to-Claude Code bridge. Message yourself on WhatsApp, get Claude Code responses back. No Moltbot, no API costs, no third-party harnesses. ~150 lines of code.

## Why

Moltbot is cool but it's a full agent framework — gateway daemon, 50+ skills, workspace memory, identity files. If you just want to talk to Claude Code from your phone, that's massive overkill.

claude-wa is the opposite: a thin pipe between WhatsApp and `claude -p`. It uses your existing Claude Max/Pro subscription through the official CLI. Nothing spoofed, nothing proxied.

## Quickstart

```bash
git clone https://github.com/yourusername/claude-wa.git
cd claude-wa
npm install
cp config.example.json config.json
# Edit config.json with your phone number
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
| `phone` | ✅ | Your phone number without `+`. Used as allowlist — bot ignores everyone else. |
| `cwd` | ❌ | Working directory for Claude Code. Defaults to `~/`. Claude runs here and has access to this project's files. |
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

### Example: Pinterest content generator (what I built this for)

```markdown
You generate daily Pinterest pins for my travel map product.
Read ~/waymarked-pinterest/audit.json for history.
Never repeat a location + style combination.
[... full workflow instructions ...]
```

The bridge doesn't care what the skill says. It just passes it through.

## Sending Images

If Claude Code generates files (screenshots, exports, etc.), you can send them back through WhatsApp. The bridge watches Claude's output for file paths and sends them as media:

If Claude's response contains a line like `[IMAGE: /path/to/file.png]`, the bridge sends it as a WhatsApp image. This is opt-in — Claude needs to output that tag, which you configure in your skill.

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

## Implementation Spec (for Claude Code to build)

### bridge.js

Entry point. Loads config, starts WhatsApp connection, wires up message handler.

```javascript
// Pseudocode flow:
// 1. Load config.json
// 2. Load skill file contents if config.skill is set
// 3. Start Baileys WhatsApp connection
// 4. On incoming message from config.phone:
//    a. Show "composing" indicator
//    b. Call claude -p with message text
//    c. Parse response for [IMAGE:] tags
//    d. Send text chunks and/or images back
// 5. Handle reconnection on disconnect
```

### lib/whatsapp.js

Manages Baileys connection lifecycle.

**Exports:**
- `connect(onMessage)` — connects to WhatsApp, calls `onMessage(text, reply)` for each incoming message from the configured phone number
- `reply` callback supports `reply.text(string)`, `reply.image(buffer, caption?)`, `reply.composing()`

**Behavior:**
- Auth state persists in `./auth/` directory (gitignored)
- QR code printed to terminal on first connection
- Auto-reconnects on non-logout disconnects
- Only processes messages from `config.phone` JID
- Ignores own outgoing messages (no echo loops)
- Ignores group messages

### lib/claude.js

Wraps `claude -p` CLI invocation.

**Exports:**
- `ask(prompt, options?)` — returns `{ text, sessionId, cost? }`

**Behavior:**
- Spawns `claude -p [prompt] --output-format json`
- Adds `--allowedTools` from config
- Adds `--append-system-prompt [skill contents]` if skill is loaded
- Adds `--max-turns [n]` if configured
- Runs in `config.cwd` directory
- Timeout from config (default 5 min)
- 10MB stdout buffer (Claude can be verbose)
- Parses JSON output for `result` field, falls back to raw stdout
- Returns session_id from JSON output (useful for --resume in future)

**Example invocation it generates:**
```bash
claude -p "Generate a pinterest pin for Santorini" \
  --output-format json \
  --allowedTools "Bash,Read,Write,Edit" \
  --append-system-prompt "You generate daily Pinterest pins for..."
```

### lib/media.js

Handles image extraction and sending.

**Exports:**
- `extractImages(text)` — scans Claude's response for `[IMAGE: /path/to/file.png]` tags, returns `{ cleanText, imagePaths[] }`

**Behavior:**
- Regex matches `[IMAGE: ...]` or `[FILE: ...]` tags in response text
- Strips tags from text before sending
- Validates file exists before attempting to send
- Supports png, jpg, jpeg, webp

### config.example.json

```json
{
  "phone": "15551234567",
  "cwd": "~",
  "allowedTools": ["Bash", "Read", "Write", "Edit"],
  "skill": null,
  "maxTurns": null,
  "timeout": 300000
}
```

### .gitignore

```
node_modules/
auth/
config.json
```

## Testing Phase 1

Once running, send these from WhatsApp:

1. `hello` — should get a Claude response back
2. `what directory are you running in?` — confirms cwd is set correctly  
3. `ls` — confirms Bash tool is allowed
4. `read package.json and tell me the name field` — confirms Read tool works

If all four work, Phase 1 is complete.

## What's Next

**Phase 2 — Waymarked Pinterest skill:**
- Skill file with map generation workflow
- Claude Code runs Playwright against localhost dev page
- Image preview sent via WhatsApp for approval
- Audit log tracking

**Phase 3 — Pinterest posting:**
- Pinterest API v5 OAuth integration
- Auto-post on approval
- Optional cron trigger for daily generation

## How This Differs from Moltbot

| | claude-wa | Moltbot |
|---|---|---|
| Lines of code | ~150 | ~100K+ |
| Dependencies | 2 (baileys, qrcode-terminal) | Hundreds |
| LLM cost | $0 (uses Max/Pro sub) | $10-300/day via API |
| Setup time | 2 minutes | 15-60 minutes |
| RAM usage | ~50MB | 300MB+ |
| Security surface | Your phone number only | Open ports, gateway, dashboard |
| Customization | Drop in a skill .md file | Workspace, hooks, plugins, skills |
| AI in the loop | Claude Code (full agent) | Claude Code or API |
| Good for | Targeted automation, single-user | Full personal AI assistant |

Moltbot is great if you want a general-purpose AI assistant across all messaging platforms. claude-wa is for when you just want Claude Code in your pocket.

## License

MIT
