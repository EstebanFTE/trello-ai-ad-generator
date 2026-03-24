import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const trello = axios.create({
  baseURL: "https://api.trello.com/1",
  params: {
    key: process.env.TRELLO_KEY,
    token: process.env.TRELLO_TOKEN,
  },
});

// Test route
app.get("/", (req, res) => {
  res.send("API is running");
});

// Pull Trello card
app.get("/brand-card/:cardId", async (req, res) => {
  try {
    const { cardId } = req.params;

    const response = await trello.get(`/cards/${cardId}`, {
      params: { customFieldItems: true },
    });

    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching card");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
