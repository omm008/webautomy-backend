require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const onboardingRoute = require("./src/routes/onboarding");

/* ======================================================
   APP INIT
====================================================== */
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ======================================================
   SUPABASE CLIENTS
====================================================== */
// Public client (JWT verification)
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// Service role (DB + RPC + bypass RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/* ======================================================
   SERVICES
====================================================== */
const walletService = require("./src/services/wallet")(supabaseAdmin);
const whatsappService = require("./src/services/whatsapp")();

/* ======================================================
   MIDDLEWARE
====================================================== */
const authMiddleware = require("./src/middleware/auth")({
  supabasePublic,
  supabaseAdmin,
});

app.use(
  "/api/onboard",
  onboardingRoute({
    supabaseAdmin,
    authMiddleware,
  }),
);

/* ======================================================
   ROUTES
====================================================== */
const webhookRoute = require("./src/routes/webhook");
const sendMessageRoute = require("./src/routes/sendMessage");
const analyticsRoute = require("./src/routes/analytics");

/* ======================================================
   HEALTH CHECK
====================================================== */
app.get("/", (req, res) => {
  res.send("🚀 WebAutomy Backend Live (Modular, Secure, Multi-Tenant)");
});

/* ======================================================
   META WEBHOOK
====================================================== */
app.use(
  "/webhook",
  webhookRoute({
    supabaseAdmin,
  }),
);

/* ======================================================
   OUTBOUND SEND MESSAGE API
====================================================== */
app.use(
  "/api/send-message",
  sendMessageRoute({
    supabaseAdmin,
    authMiddleware,
    walletService,
    whatsappService,
  }),
);

app.use(
  "/api/analytics",
  analyticsRoute({
    supabaseAdmin,
    authMiddleware,
  }),
);

/* ======================================================
   START SERVER
====================================================== */
app.listen(PORT, () => {
  console.log(`🤖 WebAutomy backend running on port ${PORT}`);
});
