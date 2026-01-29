/* ======================================================
   SEND MESSAGE ROUTE (OUTBOUND)
   - Auth protected
   - Org isolated
   - Wallet deducted atomically
   - WhatsApp send
====================================================== */

const express = require("express");
const router = express.Router();

module.exports = function sendMessageRoute({
  supabaseAdmin,
  authMiddleware,
  walletService,
  whatsappService,
}) {
  const { authenticate, loadOrgContext } = authMiddleware;
  const { deductWalletOrFail, refundWallet } = walletService;
  const { sendMessage } = whatsappService;

  /* ======================================================
     POST /api/send-message
  ====================================================== */
  router.post("/", authenticate, loadOrgContext, async (req, res) => {
    try {
      const { channel_id, to, body, mediaUrl, mediaType } = req.body;
      const orgId = req.org.id;

      if (!channel_id || !to || (!body && !mediaUrl)) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      /* ----------------------------------------------
           VERIFY CHANNEL BELONGS TO ORG
        ---------------------------------------------- */
      const { data: channel, error: channelErr } = await supabaseAdmin
        .from("channels")
        .select("org_id, phone_number_id, access_token")
        .eq("id", channel_id)
        .single();

      if (channelErr || !channel || channel.org_id !== orgId) {
        return res.status(403).json({ error: "Unauthorized channel access" });
      }

      const SERVICE_FEE = 0.2;

      /* ----------------------------------------------
           WALLET DEDUCTION (ATOMIC)
        ---------------------------------------------- */
      await deductWalletOrFail(
        orgId,
        SERVICE_FEE,
        null, // messageId (optional, outbound id later)
      );

      try {
        /* ----------------------------------------------
             SEND WHATSAPP MESSAGE
          ---------------------------------------------- */
        const sent = await sendMessage({
          phoneNumberId: channel.phone_number_id,
          accessToken: channel.access_token,
          to,
          body,
          mediaUrl,
          mediaType,
        });

        /* ----------------------------------------------
             SAVE OUTBOUND MESSAGE
          ---------------------------------------------- */
        await supabaseAdmin.from("messages").insert([
          {
            org_id: orgId,
            direction: "outbound",
            content: body || null,
            whatsapp_message_id: sent.messages?.[0]?.id,
          },
        ]);

        return res.json({ success: true });
      } catch (sendErr) {
        /* ----------------------------------------------
             REFUND IF META SEND FAILS
          ---------------------------------------------- */
        await refundWallet(
          orgId,
          SERVICE_FEE,
          null,
          "Refund: WhatsApp send failed",
        );

        throw sendErr;
      }
    } catch (err) {
      console.error("Send message error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  return router;
};
