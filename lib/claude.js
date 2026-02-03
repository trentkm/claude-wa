import { spawn } from "child_process";
import path from "path";
import os from "os";

/**
 * Expand ~ to home directory
 */
function expandHome(filepath) {
  if (filepath.startsWith("~/")) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  if (filepath === "~") {
    return os.homedir();
  }
  return filepath;
}

/**
 * Ask Claude Code a question via CLI
 * @param {string} prompt - The user's message
 * @param {Object} options - Configuration options
 * @returns {Promise<{text: string, sessionId?: string, cost?: object}>}
 */
export async function ask(prompt, options = {}) {
  const {
    cwd = "~",
    allowedTools = ["Bash", "Read", "Write", "Edit"],
    skill = null,
    maxTurns = null,
    timeout = 300000,
  } = options;

  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Add allowed tools
  if (allowedTools && allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // Add skill as system prompt appendage
  if (skill) {
    args.push("--append-system-prompt", skill);
  }

  // Add max turns limit
  if (maxTurns) {
    args.push("--max-turns", String(maxTurns));
  }

  const workingDir = expandHome(cwd);

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });

    proc.stdin.end();

    let fullResult = "";
    let sessionId = null;

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const event = JSON.parse(line);

          // Display different event types
          switch (event.type) {
            case "assistant":
              if (event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === "text") {
                    fullResult = block.text;
                    process.stdout.write(block.text);
                  } else if (block.type === "tool_use") {
                    console.log(`\n🔧 ${block.name}: ${JSON.stringify(block.input).substring(0, 100)}...`);
                  }
                }
              }
              break;

            case "content_block_delta":
              if (event.delta?.text) {
                process.stdout.write(event.delta.text);
                fullResult += event.delta.text;
              }
              break;

            case "result":
              fullResult = event.result || fullResult;
              sessionId = event.session_id;
              if (event.result) {
                console.log(`\n`);
              }
              break;
          }
        } catch {
          // Not JSON, just print raw
          process.stdout.write(line);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      // Show stderr for debugging
      console.error(`[stderr] ${data.toString()}`);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start claude: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0 && !fullResult) {
        reject(new Error(`claude exited with code ${code}`));
        return;
      }

      resolve({
        text: fullResult,
        sessionId,
      });
    });

    // Handle timeout
    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", () => clearTimeout(timeoutId));
  });
}
