require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health Check Route (Vital for Render)
app.get("/", (req, res) => {
  res.status(200).send("Server is running...");
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
