require("dotenv").config();
const express = require("express");
const axios = require("axios");
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
app.use(express.json());

// ==========================================
// 🧠 HELPER FUNCTIONS
// ==========================================

// Function to send WhatsApp Message via Meta API
async function sendWhatsAppMessage(to, bodyText) {
  if (!IS_LIVE_MODE) {
    console.log("🟡 SIMULATION: Would send:", bodyText);
    return "simulated_id";
  }

  try {
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`,
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: bodyText },
      },
    });
    return response.data.messages[0].id;
  } catch (error) {
    console.error(
      "⚠️ WhatsApp API Error:",
      error.response?.data || error.message,
    );
    return null;
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

// Start Server
app.listen(PORT, () => {
  console.log(`🤖 Server running on port ${PORT}`);
});
