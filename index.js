import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("API is running");
});

function extractCustomFieldValue(item) {
  if (!item || !item.value) return null;

  if (item.value.text !== undefined) return item.value.text;
  if (item.value.number !== undefined) return item.value.number;
  if (item.value.checked !== undefined) return item.value.checked === "true";
  if (item.value.date !== undefined) return item.value.date;

  return null;
}

app.get("/brand-card/:cardId", async (req, res) => {
  const { cardId } = req.params;

  try {
    // 1) Get the card
    const cardResponse = await axios.get(`https://api.trello.com/1/cards/${cardId}`, {
      params: {
        key: process.env.TRELLO_KEY,
        token: process.env.TRELLO_TOKEN,
        customFieldItems: true,
        fields: "id,name,desc,idBoard,url"
      }
    });

    const card = cardResponse.data;

    // 2) Get the board's custom field definitions
    const fieldDefsResponse = await axios.get(
      `https://api.trello.com/1/boards/${card.idBoard}/customFields`,
      {
        params: {
          key: process.env.TRELLO_KEY,
          token: process.env.TRELLO_TOKEN
        }
      }
    );

    const fieldDefs = fieldDefsResponse.data;

    // 3) Build lookup map
    const fieldMap = {};
    for (const def of fieldDefs) {
      fieldMap[def.id] = def.name;
    }

    // 4) Convert raw customFieldItems into readable fields
    const fields = {};
    for (const item of card.customFieldItems || []) {
      const fieldName = fieldMap[item.idCustomField];
      if (!fieldName) continue;

      fields[fieldName] = extractCustomFieldValue(item);
    }

    // 5) Return clean result
    res.json({
      ok: true,
      card_id: card.id,
      card_name: card.name,
      card_url: card.url,
      description: card.desc,
      fields
    });
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
