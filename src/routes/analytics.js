const express = require("express");
const router = express.Router();

module.exports = function analyticsRoute({ supabaseAdmin, authMiddleware }) {
  const { authenticate, loadOrgContext } = authMiddleware;

  // GET /api/analytics/summary
  router.get("/summary", authenticate, loadOrgContext, async (req, res) => {
    try {
      const orgId = req.org.id;

      // 1. Total contacts
      const { count: totalContacts } = await supabaseAdmin
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);

      // 2. Active flows
      const { count: activeFlows } = await supabaseAdmin
        .from("automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_active", true);

      // 3. Messages today
      const today = new Date().toISOString().split("T")[0];
      const { count: messagesToday } = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", today);

      // 4. Wallet balance
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("org_id", orgId)
        .single();

      return res.json({
        walletBalance: wallet?.balance || 0,
        summaryCards: [
          {
            id: "users",
            title: "Total Users",
            value: totalContacts || 0,
            change: "+0%",
          },
          {
            id: "flows",
            title: "Active Flows",
            value: activeFlows || 0,
          },
          {
            id: "messages",
            title: "Messages Today",
            value: messagesToday || 0,
            change: "+0%",
          },
        ],
      });
    } catch (err) {
      console.error("Analytics error:", err.message);
      res.status(500).json({ error: "Failed to load analytics" });
    }
  });

  return router;
};
