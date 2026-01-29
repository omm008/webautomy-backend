/* ======================================================
   WHATSAPP SERVICE (META API WRAPPER)
   - Pure API calls
   - No DB
   - No Express
   - No business logic
====================================================== */

const axios = require("axios");

module.exports = function whatsappService() {
  /* ----------------------------------------------
     SEND TEXT MESSAGE
  ---------------------------------------------- */
  async function sendTextMessage({ phoneNumberId, accessToken, to, body }) {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    };

    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  }

  /* ----------------------------------------------
     SEND MEDIA MESSAGE (IMAGE / DOCUMENT)
  ---------------------------------------------- */
  async function sendMediaMessage({
    phoneNumberId,
    accessToken,
    to,
    mediaUrl,
    mediaType = "image",
    caption = null,
  }) {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
        ...(caption ? { caption } : {}),
      },
    };

    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  }

  /* ----------------------------------------------
     GENERIC SEND (AUTO SWITCH)
  ---------------------------------------------- */
  async function sendMessage({
    phoneNumberId,
    accessToken,
    to,
    body,
    mediaUrl = null,
    mediaType = "image",
  }) {
    if (mediaUrl) {
      return sendMediaMessage({
        phoneNumberId,
        accessToken,
        to,
        mediaUrl,
        mediaType,
        caption: body,
      });
    }

    return sendTextMessage({
      phoneNumberId,
      accessToken,
      to,
      body,
    });
  }

  return {
    sendTextMessage,
    sendMediaMessage,
    sendMessage,
  };
};
