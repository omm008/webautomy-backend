require("dotenv").config();
const express = require("express"); // Sirf ek baar aana chahiye
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🛡️ SECURITY LAYER
// ==========================================

// 1. TRUST PROXY
app.set("trust proxy", 1);

// 2. CORS POLICY
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

// 3. RATE LIMITING
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 4. BODY PARSER
app.use(express.json());

// ==========================================
// 🗄️ DATABASE CONNECTION
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// ==========================================
// 🛣️ ROUTES
// ==========================================

// Health Check
app.get("/", (req, res) => {
  res.send("🚀 WebAutomy Backend Engine is Running & Secure!");
});

// WEBHOOK VERIFICATION
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

// INCOMING MESSAGES
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

        console.log(`📩 New Message from ${senderName} (${from}): ${msg_body}`);

        // DB Logic
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

        if (contact) {
          const { error: msgError } = await supabase.from("messages").insert([
            {
              contact_id: contact.id,
              direction: "inbound",
              content: msg_body,
              status: "delivered",
              whatsapp_message_id: messageData.id,
            },
          ]);
          if (msgError) console.error("Error saving message:", msgError);
          else console.log("💾 Message Saved to Database!");
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

// SEND MESSAGE API
app.post("/api/send-message", async (req, res) => {
  const { phone, message } = req.body;

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
        to: phone,
        type: "text",
        text: { body: message },
      },
    });

    console.log("📤 Message Sent via Meta!");
    res.json({ status: "success", message: "Message sent!" });
  } catch (error) {
    console.error(
      "❌ Error sending message:",
      error.response ? error.response.data : error.message,
    );
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Backend Engine listening on port ${PORT}`);
});
