require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");
const express = require("express");
const app = express();

// 👇 1. IMPORT SECURITY PACKAGES
const rateLimit = require("express-rate-limit");

// 👇 2. TRUST PROXY (Render/Heroku ke liye zaroori hai)
app.set("trust proxy", 1);
// 1. Supabase Import kiya
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// 2. Supabase Connection Banaya
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// Health Check
app.get("/", (req, res) => {
  res.send("WebAutomy Backend Engine is Running & Connected to DB... 🚀");
});

// WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.MY_VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED ✅");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 3. INCOMING MESSAGES (Save to Supabase)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const change = body.entry[0].changes[0].value;
      const messageData = change.messages[0];
      const contactData = change.contacts[0]; // Sender ka naam bhi aata hai

      const phone_number_id = change.metadata.phone_number_id;
      const from = messageData.from; // Customer Number
      const msg_body = messageData.text.body; // Message Text
      const senderName = contactData.profile.name; // Sender Name

      console.log(`📩 New Message from ${senderName} (${from}): ${msg_body}`);

      try {
        // A. Check karo agar Contact pehle se hai ya naya hai
        let { data: contact, error: contactError } = await supabase
          .from("contacts")
          .select("id")
          .eq("phone", from)
          .single();

        if (!contact) {
          // Naya Contact banao
          const { data: newContact, error: createError } = await supabase
            .from("contacts")
            .insert([{ name: senderName, phone: from }])
            .select()
            .single();
          contact = newContact;
        }

        // B. Message ko 'messages' table mein save karo
        const { error: msgError } = await supabase.from("messages").insert([
          {
            contact_id: contact.id,
            direction: "inbound", // Customer ne bheja
            content: msg_body,
            status: "delivered",
            whatsapp_message_id: messageData.id,
          },
        ]);

        if (msgError) console.error("Error saving message:", msgError);
        else console.log("💾 Message Saved to Database!");
      } catch (err) {
        console.error("Database Error:", err);
      }

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  }
});

// SEND MESSAGE API
app.post("/api/send-message", async (req, res) => {
  const { phone, message } = req.body;

  try {
    // 1. Meta ko Message Bhejo
    const response = await axios({
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

    // 2. Outbound Message ko DB mein save karo
    // (Iske liye humein pehle contact ID dhundni hogi, abhi ke liye skip karte hain simple rakhte hain)

    res.json({ status: "success", message: "Message sent!" });
  } catch (error) {
    console.error(
      "Error sending message:",
      error.response ? error.response.data : error.message,
    );
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Backend Engine listening on port ${PORT}`);
});
