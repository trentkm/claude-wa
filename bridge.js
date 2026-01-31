#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connect } from "./lib/whatsapp.js";
import { ask } from "./lib/claude.js";
import { extractImages, readImage } from "./lib/media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load configuration
const configPath = path.join(__dirname, "config.json");

if (!fs.existsSync(configPath)) {
  console.error("❌ config.json not found. Copy config.example.json to config.json and edit it.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

if (!config.phone) {
  console.error("❌ config.phone is required. Set your phone number (without +) in config.json");
  process.exit(1);
}

// Load skill file if configured
let skillContent = null;
if (config.skill) {
  const skillPath = path.resolve(__dirname, config.skill);
  if (fs.existsSync(skillPath)) {
    skillContent = fs.readFileSync(skillPath, "utf-8");
    console.log(`📚 Loaded skill: ${config.skill}`);
  } else {
    console.warn(`⚠️ Skill file not found: ${skillPath}`);
  }
}

console.log(`
╔═══════════════════════════════════════╗
║          claude-wa bridge             ║
╠═══════════════════════════════════════╣
║  Phone: ${config.phone.padEnd(28)}║
║  CWD:   ${(config.cwd || "~").padEnd(28)}║
║  Skill: ${(config.skill || "none").padEnd(28)}║
╚═══════════════════════════════════════╝
`);

// Message handler
async function handleMessage(text, reply) {
  console.log(`\n🤖 Processing: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`);

  // Show composing indicator
  await reply.composing();

  try {
    // Call Claude Code
    const response = await ask(text, {
      cwd: config.cwd,
      allowedTools: config.allowedTools,
      skill: skillContent,
      maxTurns: config.maxTurns,
      timeout: config.timeout,
    });

    // Stop composing
    await reply.paused();

    // Extract any images from the response
    const { cleanText, imagePaths } = extractImages(response.text);

    // Send text response (if any)
    if (cleanText) {
      // WhatsApp has a ~65KB message limit, split if needed
      const MAX_LENGTH = 4000;
      if (cleanText.length > MAX_LENGTH) {
        const chunks = [];
        for (let i = 0; i < cleanText.length; i += MAX_LENGTH) {
          chunks.push(cleanText.slice(i, i + MAX_LENGTH));
        }
        for (const chunk of chunks) {
          await reply.text(chunk);
        }
      } else {
        await reply.text(cleanText);
      }
    }

    // Send images (if any)
    for (const imagePath of imagePaths) {
      try {
        const buffer = readImage(imagePath);
        const filename = path.basename(imagePath);
        await reply.image(buffer, filename);
        console.log(`📷 Sent image: ${filename}`);
      } catch (err) {
        console.error(`Failed to send image ${imagePath}:`, err);
      }
    }

    console.log(`✅ Response sent (${response.text.length} chars, ${imagePaths.length} images)`);

  } catch (err) {
    await reply.paused();
    console.error("❌ Claude error:", err.message);
    await reply.text(`Error: ${err.message}`);
  }
}

// Start the bridge
connect(config, handleMessage).catch((err) => {
  console.error("Failed to connect:", err);
  process.exit(1);
});
