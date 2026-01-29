/* ======================================================
   META WEBHOOK ROUTE
   - Inbound messages only
   - Multi-tenant routing via phone_number_id
   - No auth, no wallet, no outbound sends
====================================================== */

const express = require("express");
const router = express.Router();

module.exports = function webhookRoute({ supabaseAdmin }) {
  /* ======================================================
     META WEBHOOK VERIFICATION (GET)
  ====================================================== */
  router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  });

  /* ======================================================
     META WEBHOOK RECEIVE (POST)
     - inbound text messages only
  ====================================================== */
  router.post("/", async (req, res) => {
    // Always ACK fast to Meta
    res.sendStatus(200);

    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      // Ignore non-message events
      if (!message || !message.text) return;

      const phoneNumberId = change.metadata.phone_number_id;
      const customerPhone = message.from;
      const messageText = message.text.body;
      const customerName = change.contacts?.[0]?.profile?.name || "Unknown";

      /* ----------------------------------------------
         FIND CHANNEL → ORG
      ---------------------------------------------- */
      const { data: channel, error: channelErr } = await supabaseAdmin
        .from("channels")
        .select("org_id")
        .eq("phone_number_id", phoneNumberId)
        .single();

      if (channelErr || !channel) {
        console.error(
          "Webhook received for unknown phone_number_id:",
          phoneNumberId,
        );
        return;
      }

      const orgId = channel.org_id;

      /* ----------------------------------------------
         FIND OR CREATE CONTACT (ORG-SCOPED)
      ---------------------------------------------- */
      let { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("phone", customerPhone)
        .eq("org_id", orgId)
        .single();

      if (!contact) {
        const { data: newContact, error: contactErr } = await supabaseAdmin
          .from("contacts")
          .insert([
            {
              org_id: orgId,
              phone: customerPhone,
              name: customerName,
            },
          ])
          .select()
          .single();

        if (contactErr) {
          console.error("Contact create failed:", contactErr.message);
          return;
        }

        contact = newContact;
      }

      /* ----------------------------------------------
         SAVE INBOUND MESSAGE
      ---------------------------------------------- */
      await supabaseAdmin.from("messages").insert([
        {
          org_id: orgId,
          contact_id: contact.id,
          direction: "inbound",
          content: messageText,
          whatsapp_message_id: message.id,
        },
      ]);
    } catch (err) {
      console.error("Webhook processing error:", err.message);
    }
  });

  return router;
};
