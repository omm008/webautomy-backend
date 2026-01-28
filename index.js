require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🛠️ CONFIGURATION & SETUP
// ==========================================

// Check if we are ready to send real messages
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const IS_LIVE_MODE = WA_TOKEN && WA_TOKEN.length > 20;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// Middleware
app.use(cors()); // 👈 Enable CORS for Frontend Communication
app.use(express.json());

// ==========================================
// 🧠 HELPER FUNCTIONS
// ==========================================

// Function to send WhatsApp Message via Meta API
async function sendWhatsAppMessage(
  to,
  body,
  mediaUrl = null,
  mediaType = "text",
) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.error(
      "❌ Error: WA_TOKEN or WA_PHONE_NUMBER_ID is missing in .env",
    );
    return;
  }

  // Payload prepare karo (Text vs Media)
  let payload = {
    messaging_product: "whatsapp",
    to: to,
  };

  if (mediaUrl) {
    // === MEDIA MESSAGE ===
    const type = mediaType.startsWith("image") ? "image" : "document";
    payload.type = type;
    payload[type] = { link: mediaUrl };
    if (type === "document")
      payload[type].caption = body || "Sent via WebAutomy";
  } else {
    // === TEXT MESSAGE ===
    payload.type = "text";
    payload.text = { body: body };
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneId}/messages`, // v22.0 latest hai
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    console.log("✅ Message sent to WhatsApp:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending message:",
      error.response ? error.response.data : error.message,
    );
    throw error;
  }
}

// Function to handle Auto-Replies
async function handleAutoReply(contactId, inboundText, phoneNumber) {
  try {
    // 1. Fetch Active Rules
    const { data: rules, error } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("is_active", true);

    if (error || !rules || rules.length === 0) return;

    // 2. Find a Match
    const matchedRule = rules.find((rule) => {
      const trigger = rule.trigger_keyword.toLowerCase().trim();
      const message = inboundText.toLowerCase().trim();

      return rule.match_type === "exact"
        ? message === trigger
        : message.includes(trigger);
    });

    // 3. Send Reply if Matched
    if (matchedRule) {
      console.log(`✅ Rule Matched: ${matchedRule.trigger_keyword}`);

      const replyText = matchedRule.reply_message;
      const sentMsgId = await sendWhatsAppMessage(phoneNumber, replyText);

      // Save the reply to DB
      if (sentMsgId) {
        await supabase.from("messages").insert([
          {
            contact_id: contactId,
            direction: "outbound",
            content: replyText,
            status: IS_LIVE_MODE ? "sent" : "simulated",
            whatsapp_message_id: sentMsgId,
          },
        ]);
      }
    }
  } catch (err) {
    console.error("❌ Auto-Reply Logic Error:", err.message);
  }
}

// ==========================================
// 🛣️ ROUTES
// ==========================================

// Health Check
app.get("/", (req, res) => {
  res.send(
    `🚀 WebAutomy Bot is Active! Mode: ${IS_LIVE_MODE ? "LIVE 🟢" : "DEV 🟡"}`,
  );
});

// Meta Webhook Verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.MY_VERIFY_TOKEN) {
    console.log("✅ Webhook Verified Successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Meta Webhook Event Listener (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Immediately respond to Meta to prevent timeout
  res.sendStatus(200);

  try {
    if (
      body.object &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const change = body.entry[0].changes[0].value;
      const messageData = change.messages[0];
      const contactData = change.contacts ? change.contacts[0] : null;

      // Ignore status updates (sent, delivered, read) - only process text messages
      if (!messageData.text) return;

      const fromPhone = messageData.from; // e.g., 919999999999
      const msgBody = messageData.text.body;
      const senderName = contactData?.profile?.name || "Unknown";

      console.log(`📩 New Message from ${senderName}: ${msgBody}`);

      // --- SUPABASE LOGIC START ---

      // 1. Find or Create Contact
      let { data: contact, error: fetchError } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone", fromPhone)
        .single();

      if (!contact) {
        const { data: newContact, error: createError } = await supabase
          .from("contacts")
          .insert([{ name: senderName, phone: fromPhone }])
          .select()
          .single();

        if (createError) throw createError;
        contact = newContact;
      }

      // 2. Save Inbound Message
      await supabase.from("messages").insert([
        {
          contact_id: contact.id,
          direction: "inbound",
          content: msgBody,
          status: "delivered",
          whatsapp_message_id: messageData.id,
        },
      ]);

      // 3. Trigger Automation (Async)
      handleAutoReply(contact.id, msgBody, fromPhone);

      // --- SUPABASE LOGIC END ---
    }
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error.message);
  }
});

// ==========================================
// 📨 API FOR FRONTEND (SEND MESSAGE)
// ==========================================
app.post("/api/send-message", async (req, res) => {
  // Frontend se ye data aayega
  const { phone, message, mediaUrl, mediaType } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    // Helper function ko call karo
    const response = await sendWhatsAppMessage(
      phone,
      message,
      mediaUrl,
      mediaType,
    );
    res.status(200).json({ success: true, data: response });
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🤖 Server running on port ${PORT}`);
});
