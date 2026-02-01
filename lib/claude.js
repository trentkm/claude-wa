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
    "json",
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
      env: { ...process.env, CI: "true" }, // Disable interactive prompts
    });

    // Close stdin immediately - we don't need input
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start claude: ${err.message}`));
    });

    proc.on("close", (code) => {

      if (code !== 0 && !stdout) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Try to parse JSON output
        const json = JSON.parse(stdout);
        resolve({
          text: json.result || json.message || stdout,
          sessionId: json.session_id,
          cost: json.cost,
        });
      } catch {
        // Fall back to raw stdout if not valid JSON
        resolve({
          text: stdout.trim() || stderr.trim(),
        });
      }
    });

    // Handle timeout
    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", () => clearTimeout(timeoutId));
  });
}
