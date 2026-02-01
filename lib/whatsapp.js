import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Silent logger to suppress Baileys noise
const logger = pino({ level: "silent" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "auth");

// Ensure auth directory exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

/**
 * Connect to WhatsApp and handle incoming messages
 * @param {Object} config - Configuration object with phone number
 * @param {Function} onMessage - Callback: (text, reply) => void
 * @returns {Promise<Object>} - The socket connection
 */
export async function connect(config, onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Fetch the latest version to avoid 405 errors
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using WA version: ${version.join(".")}`);

  const sock = makeWASocket({
    auth: state,
    logger,
    version,
    browser: Browsers.macOS("Safari"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Track message IDs we've sent to avoid echo loops
  const sentMessageIds = new Set();

  // Handle connection updates
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Display QR code for scanning
    if (qr) {
      console.log("\n📱 Scan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log("Open WhatsApp → Settings → Linked Devices → Link a Device\n");
    }

    if (connection === "connecting") {
      console.log("⏳ Connecting...");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Reconnect after a short delay
        setTimeout(() => connect(config, onMessage), 3000);
      } else {
        console.log("Logged out. Delete the auth/ folder and restart to re-link.");
      }
    }

    if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
    }
  });

  // Save credentials when they update
  sock.ev.on("creds.update", saveCreds);

  // Handle incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // Debug: log all message events
    console.log(`[DEBUG] messages.upsert type=${type}, count=${messages.length}`);

    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip if no message content
      if (!msg.message) continue;

      // Skip messages we sent (prevent echo loops)
      if (sentMessageIds.has(msg.key.id)) {
        sentMessageIds.delete(msg.key.id); // Clean up
        continue;
      }

      // Get the remote JID
      const remoteJid = msg.key.remoteJid;

      // Skip group messages
      if (remoteJid.endsWith("@g.us")) continue;

      // Extract phone number from JID (format: 15551234567@s.whatsapp.net)
      const chatPhone = remoteJid.split("@")[0];

      // Only process messages from/to the configured phone number
      if (chatPhone !== config.phone) {
        console.log(`Ignoring message from chat ${chatPhone} (not ${config.phone})`);
        continue;
      }

      // Extract message text
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (!text) continue;

      console.log(`📩 Received: ${text.substring(0, 50)}${text.length > 50 ? "..." : ""}`);

      // Create reply helper
      const reply = {
        text: async (content) => {
          const sent = await sock.sendMessage(remoteJid, { text: content });
          if (sent?.key?.id) sentMessageIds.add(sent.key.id);
        },
        image: async (buffer, caption) => {
          const sent = await sock.sendMessage(remoteJid, {
            image: buffer,
            caption: caption || undefined,
          });
          if (sent?.key?.id) sentMessageIds.add(sent.key.id);
        },
        composing: async () => {
          await sock.sendPresenceUpdate("composing", remoteJid);
        },
        paused: async () => {
          await sock.sendPresenceUpdate("paused", remoteJid);
        },
      };

      // Call the message handler
      try {
        await onMessage(text, reply);
      } catch (err) {
        console.error("Error handling message:", err);
        await reply.text(`Error: ${err.message}`);
      }
    }
  });

  return sock;
}
