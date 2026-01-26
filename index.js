require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
// Agar .env me WA_TOKEN nahi hai, to hum "Simulation Mode" me rahenge
const IS_LIVE_MODE = process.env.WA_TOKEN && process.env.WA_TOKEN.length > 10;

// ==========================================
// 🛡️ SECURITY LAYER
// ==========================================
app.set("trust proxy", 1);

const allowedOrigins = [
  "https://webautomy.com",
  "https://app.webautomy.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log("🚫 Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
app.use(express.json());

// ==========================================
// 🗄️ DATABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// ==========================================
// 🤖 THE BRAIN: AUTO-REPLY LOGIC
// ==========================================
async function checkAndSendAutoReply(contactId, inboundText, phoneNumber) {
  try {
    console.log(`🧠 Thinking... Checking rules for: "${inboundText}"`);

    // 1. Fetch All Rules (Active only)
    const { data: rules, error } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("is_active", true);

    if (error || !rules) return;

    // 2. Find a Match
    const matchedRule = rules.find((rule) => {
      const trigger = rule.trigger_keyword.toLowerCase();
      const message = inboundText.toLowerCase();

      if (rule.match_type === "exact") return message === trigger;
      // Default: Contains
      return message.includes(trigger);
    });

    // 3. Agar Match mila, to Reply karo
    if (matchedRule) {
      console.log(`✅ Rule Matched! Trigger: ${matchedRule.trigger_keyword}`);
      const replyText = matchedRule.reply_message;

      // --- BRANCH A: LIVE MODE (Send to WhatsApp) ---
      if (IS_LIVE_MODE) {
        try {
          await axios({
            method: "POST",
            url: `https://graph.facebook.com/v17.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
            headers: {
              Authorization: `Bearer ${process.env.WA_TOKEN}`,
              "Content-Type": "application/json",
            },
            data: {
              messaging_product: "whatsapp",
              to: phoneNumber,
              type: "text",
              text: { body: replyText },
            },
          });
          console.log("📤 Sent to WhatsApp Real API");
        } catch (apiError) {
          console.error(
            "⚠️ Meta API Failed (Continuing to save to DB):",
            apiError.message,
          );
        }
      } else {
        console.log("🔕 Simulation Mode: Skipping Meta API call.");
      }

      // --- BRANCH B: DATABASE MODE (Save Reply to DB) ---
      // Ye zaroori hai taaki Dashboard par reply dikhe
      await supabase.from("messages").insert([
        {
          contact_id: contactId,
          direction: "outbound", // Ye humne bheja
          content: replyText,
          status: IS_LIVE_MODE ? "sent" : "simulated", // Status alag rakha taaki pata chale
          created_at: new Date().toISOString(),
        },
      ]);
      console.log("💾 Auto-Reply Saved to DB");
    }
  } catch (err) {
    console.error("❌ Auto-Reply Error:", err);
  }
}

// ==========================================
// 🛣️ ROUTES
// ==========================================

app.get("/", (req, res) => {
  res.send(
    `🚀 WebAutomy Backend is Running! Mode: ${IS_LIVE_MODE ? "LIVE 🟢" : "SIMULATION 🟡"}`,
  );
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.MY_VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;

  try {
    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const change = body.entry[0].changes[0].value;
        const messageData = change.messages[0];
        const contactData = change.contacts ? change.contacts[0] : null;

        const from = messageData.from;
        const msg_body = messageData.text?.body || "";
        const senderName = contactData?.profile?.name || "Unknown";

        console.log(`📩 Inbound: ${msg_body} from ${senderName}`);

        // 1. Contact Save/Find
        let { data: contact, error: contactError } = await supabase
          .from("contacts")
          .select("id")
          .eq("phone", from)
          .single();

        if (!contact) {
          const { data: newContact, error: createError } = await supabase
            .from("contacts")
            .insert([{ name: senderName, phone: from }])
            .select()
            .single();
          if (createError) throw createError;
          contact = newContact;
        }

        // 2. Message Save
        if (contact) {
          await supabase.from("messages").insert([
            {
              contact_id: contact.id,
              direction: "inbound",
              content: msg_body,
              status: "delivered",
              whatsapp_message_id: messageData.id,
            },
          ]);
          console.log("💾 Inbound Saved!");

          // 👉 3. TRIGGER AUTO-REPLY (Simulation or Live)
          // Thoda delay taaki natural lage (1 second)
          setTimeout(() => {
            checkAndSendAutoReply(contact.id, msg_body, from);
          }, 1000);
        }

        res.sendStatus(200);
      } else {
        res.sendStatus(200);
      }
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("❌ Webhook Error:", error);
    res.sendStatus(200);
  }
});

// Manual Send API (Outbound)
app.post("/api/send-message", async (req, res) => {
  const { phone, message } = req.body;
  // Isme bhi same IS_LIVE_MODE logic laga sakte ho agar chaho
  // Abhi ke liye simple rakhte hain
  res.json({ status: "success", message: "Use Dashboard for simulation now." });
});

app.listen(PORT, () => {
  console.log(`🤖 Backend Engine listening on port ${PORT}`);
});
