import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ CRITICAL FIX
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ------------------ BASIC TEST ------------------

app.get("/", (req, res) => {
  res.send("trello-ai-ad-generator is running");
});

// ------------------ TRELLO ------------------

async function trelloGet(url, params = {}) {
  const res = await axios.get(url, {
    params: {
      key: process.env.TRELLO_KEY,
      token: process.env.TRELLO_TOKEN,
      ...params,
    },
  });
  return res.data;
}

// 🔥 FIXED CARD LOOKUP
async function getCardByAnyId(cardId) {
  const cards = await trelloGet(
    `https://api.trello.com/1/boards/${process.env.TRELLO_BOARD_ID}/cards`,
    { fields: "id,name,shortLink,idShort" }
  );

  const match = cards.find(
    (c) =>
      c.id === cardId ||
      c.shortLink === cardId ||
      String(c.idShort) === String(cardId)
  );

  if (!match) throw new Error("Card not found");

  return trelloGet(`https://api.trello.com/1/cards/${match.id}`, {
    fields: "id,name,desc",
  });
}

// ------------------ IMAGE ------------------

async function generateImage() {
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt: "clean dealership automotive scene, realistic lighting",
    size: "1024x1024",
  });

  const base64 = result.data[0].b64_json;

  const fileName = `img-${Date.now()}.png`;
  const filePath = path.join(__dirname, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));

  return { fileName, filePath };
}

// ------------------ ATTACH ------------------

async function attachToCard(cardId, filePath, fileName) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  const res = await axios.post(
    `https://api.trello.com/1/cards/${cardId}/attachments`,
    form,
    {
      headers: form.getHeaders(),
      params: {
        key: process.env.TRELLO_KEY,
        token: process.env.TRELLO_TOKEN,
        name: fileName,
      },
    }
  );

  return res.data;
}

// ------------------ ROUTE ------------------

app.get("/generate-reference-image/:cardId", async (req, res) => {
  try {
    const { cardId } = req.params;

    console.log("Incoming ID:", cardId);

    const card = await getCardByAnyId(cardId);

    console.log("Resolved ID:", card.id);

    const { fileName, filePath } = await generateImage();

    const attachment = await attachToCard(card.id, filePath, fileName);

    fs.unlinkSync(filePath);

    res.json({
      ok: true,
      attachment: attachment.url,
    });
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);

    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

// ✅ CRITICAL FIX
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
