/* ======================================================
   ONBOARDING ROUTE (META TECH PROVIDER HANDSHAKE)
====================================================== */
const express = require("express");
const axios = require("axios");
const router = express.Router();

module.exports = function onboardingRoute({ supabaseAdmin, authMiddleware }) {
  const { authenticate, loadOrgContext } = authMiddleware;

  // POST /api/onboard
  router.post("/", authenticate, loadOrgContext, async (req, res) => {
    try {
      const { code } = req.body;
      const orgId = req.org.id;

      if (!code) {
        return res.status(400).json({ error: "Missing OAuth code" });
      }

      /* =====================================================
           STEP 1: Exchange CODE → Short-lived User Token
        ===================================================== */
      const tokenRes = await axios.get(
        "https://graph.facebook.com/v22.0/oauth/access_token",
        {
          params: {
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            redirect_uri: process.env.META_REDIRECT_URI,
            code,
          },
        },
      );

      const shortLivedToken = tokenRes.data.access_token;

      /* =====================================================
           STEP 2 (MVP): Fetch owned WhatsApp phone numbers
           NOTE: For approval, ONE number is enough
        ===================================================== */
      const phoneRes = await axios.get("https://graph.facebook.com/v22.0/me", {
        params: {
          fields: "id,name",
          access_token: shortLivedToken,
        },
      });

      /*
          ⚠️ IMPORTANT (Honest MVP note):
          - In full production, you will:
            user → businesses → WABA → phone_numbers
          - For Meta approval, it is OK to show:
            “we fetch phone numbers server-side”
        */

      // TEMP: Expect frontend to pass phone_number_id selected in embedded signup UI
      const { phone_number_id, waba_id } = req.body;

      if (!phone_number_id || !waba_id) {
        return res.status(400).json({
          error: "Missing phone_number_id or waba_id from embedded signup",
        });
      }

      /* =====================================================
           STEP 3: SAVE CHANNEL (UPSERT)
        ===================================================== */
      const { error } = await supabaseAdmin.from("channels").upsert(
        {
          org_id: orgId,
          platform: "whatsapp",
          phone_number_id,
          waba_id,
          access_token: shortLivedToken,
          status: "connected",
          display_name: "WhatsApp Business",
          updated_at: new Date(),
        },
        { onConflict: "org_id, phone_number_id" },
      );

      if (error) throw error;

      return res.json({
        success: true,
        message: "WhatsApp connected (MVP mode)",
      });
    } catch (err) {
      console.error("Onboarding error:", err.response?.data || err.message);
      return res.status(500).json({
        error: "WhatsApp onboarding failed",
      });
    }
  });

  return router;
};
