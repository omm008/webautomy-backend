/* ======================================================
   WALLET SERVICE (RPC-BASED, ATOMIC)
   - No Express here
   - No req / res
   - Pure business logic
====================================================== */

module.exports = function walletService(supabaseAdmin) {
  /* ----------------------------------------------
     DEDUCT WALLET OR FAIL
  ---------------------------------------------- */
  async function deductWalletOrFail(orgId, amount, messageId = null) {
    const { data, error } = await supabaseAdmin.rpc("deduct_service_fee", {
      p_org_id: orgId,
      p_service_fee: amount,
      p_message_id: messageId,
    });

    if (error) {
      throw new Error(`Wallet deduction failed: ${error.message}`);
    }

    if (data !== true) {
      throw new Error("Insufficient wallet balance");
    }

    return true;
  }

  /* ----------------------------------------------
     REFUND WALLET
  ---------------------------------------------- */
  async function refundWallet(
    orgId,
    amount,
    messageId = null,
    reason = "Refund",
  ) {
    const { error } = await supabaseAdmin.rpc("refund_service_fee", {
      p_org_id: orgId,
      p_amount: amount,
      p_message_id: messageId,
      p_reason: reason,
    });

    if (error) {
      console.error("Refund failed:", error.message);
    }
  }

  return {
    deductWalletOrFail,
    refundWallet,
  };
};
