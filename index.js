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
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

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

// 🔥 FORCE FIND CARD BY SHORT ID
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

  console.log("FOUND CARD:", match);

  // ALWAYS USE REAL ID FROM HERE ON
  return trelloGet(`https://api.trello.com/1/cards/${match.id}`, {
    fields: "id,name,desc,labels",
    attachments: true,
    customFieldItems: true,
  });
}

// ------------------ IMAGE ------------------

async function generateImage(prompt) {
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const base64 = result.data[0].b64_json;

  const fileName = `img-${Date.now()}.png`;
  const filePath = path.join(TMP_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));

  return { fileName, filePath };
}

// ------------------ ATTACH ------------------

async function attachToCard(cardId, filePath, fileName) {
  console.log("ATTACHING TO CARD ID:", cardId);

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

    console.log("REQUEST CARD ID:", cardId);

    const card = await getCardByAnyId(cardId);

    console.log("REAL CARD ID:", card.id);

    const prompt = `Clean automotive dealership scene, realistic lighting, no text, no logos`;

    const { fileName, filePath } = await generateImage(prompt);

    const attachment = await attachToCard(card.id, filePath, fileName);

    fs.unlinkSync(filePath);

    res.json({
      ok: true,
      cardId: card.id,
      attachment: attachment.url,
    });
  } catch (err) {
    console.error("FULL ERROR:", err.response?.data || err.message);

    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

// ------------------

app.get("/", (req, res) => {
  res.send("trello-ai-ad-generator is running");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
