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
  const { cardId } = req.params;

  try {
    const response = await axios.get(`https://api.trello.com/1/cards/${cardId}`, {
      params: {
        key: process.env.TRELLO_KEY,
        token: process.env.TRELLO_TOKEN,
        customFieldItems: true,
        fields: "id,name,desc,idBoard,url"
      }
    });

    res.json({
      ok: true,
      keyExists: !!process.env.TRELLO_KEY,
      tokenExists: !!process.env.TRELLO_TOKEN,
      card: response.data
    });
  } catch (error) {
    console.error("FULL TRELLO ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      keyExists: !!process.env.TRELLO_KEY,
      tokenExists: !!process.env.TRELLO_TOKEN,
      cardId,
      details: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
