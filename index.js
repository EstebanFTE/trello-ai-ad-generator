import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/brand-card/:cardId", async (req, res) => {
  try {
    const { cardId } = req.params;

    const url = `https://api.trello.com/1/cards/${cardId}`;

    const response = await axios.get(url, {
      params: {
        key: process.env.TRELLO_KEY,
        token: process.env.TRELLO_TOKEN,
        customFieldItems: true,
        fields: "id,name,desc,idBoard,url"
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error("FULL TRELLO ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Error fetching card",
      details: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
