import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["claude-wa", "Chrome", "1.0.0"],
  });

  // Handle connection updates
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Scan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log("\nGo to WhatsApp → Settings → Linked Devices → Link a Device\n");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`
      );

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
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip if no message content
      if (!msg.message) continue;

      // Skip own outgoing messages (no echo loops)
      if (msg.key.fromMe) continue;

      // Get the remote JID (sender)
      const remoteJid = msg.key.remoteJid;

      // Skip group messages
      if (remoteJid.endsWith("@g.us")) continue;

      // Extract phone number from JID (format: 15551234567@s.whatsapp.net)
      const senderPhone = remoteJid.split("@")[0];

      // Only process messages from the configured phone number
      if (senderPhone !== config.phone) {
        console.log(`Ignoring message from ${senderPhone} (not ${config.phone})`);
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
          await sock.sendMessage(remoteJid, { text: content });
        },
        image: async (buffer, caption) => {
          await sock.sendMessage(remoteJid, {
            image: buffer,
            caption: caption || undefined,
          });
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
