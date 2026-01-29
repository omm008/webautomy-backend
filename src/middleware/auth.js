/* ======================================================
   AUTH & ORG CONTEXT MIDDLEWARE
   - Supabase JWT verification
   - User → Org resolution
   - NO business logic here
====================================================== */

module.exports = function authMiddleware({ supabasePublic, supabaseAdmin }) {
  /* ----------------------------------------------
     AUTHENTICATE USER (Bearer JWT)
  ---------------------------------------------- */
  async function authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");

      if (!token) {
        return res.status(401).json({ error: "Missing auth token" });
      }

      const { data, error } = await supabasePublic.auth.getUser(token);

      if (error || !data?.user) {
        return res.status(401).json({ error: "Invalid auth token" });
      }

      req.user = data.user;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Authentication failed" });
    }
  }

  /* ----------------------------------------------
     LOAD ORG CONTEXT
     user → profiles → org
  ---------------------------------------------- */
  async function loadOrgContext(req, res, next) {
    try {
      const userId = req.user.id;

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("org_id, role")
        .eq("id", userId)
        .single();

      if (error || !profile?.org_id) {
        return res
          .status(403)
          .json({ error: "User not linked to any organization" });
      }

      req.org = {
        id: profile.org_id,
        role: profile.role,
      };

      next();
    } catch (err) {
      return res.status(500).json({ error: "Failed to load org context" });
    }
  }

  /* ----------------------------------------------
     OPTIONAL: ROLE GUARD (FUTURE USE)
  ---------------------------------------------- */
  function requireRole(allowedRoles = []) {
    return (req, res, next) => {
      if (!req.org || !allowedRoles.includes(req.org.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    };
  }

  return {
    authenticate,
    loadOrgContext,
    requireRole,
  };
};
