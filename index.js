import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function extractCustomFieldValue(item) {
  if (!item || !item.value) return null;

  if (item.value.text !== undefined) return item.value.text;
  if (item.value.number !== undefined) return item.value.number;
  if (item.value.checked !== undefined) return item.value.checked === "true";
  if (item.value.date !== undefined) return item.value.date;

  return null;
}

async function getBrandCard(cardId) {
  const cardResponse = await axios.get(`https://api.trello.com/1/cards/${cardId}`, {
    params: {
      key: process.env.TRELLO_KEY,
      token: process.env.TRELLO_TOKEN,
      customFieldItems: true,
      fields: "id,name,desc,idBoard,url"
    }
  });

  const card = cardResponse.data;

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

  const fieldMap = {};
  for (const def of fieldDefs) {
    fieldMap[def.id] = def.name;
  }

  const fields = {};
  for (const item of card.customFieldItems || []) {
    const fieldName = fieldMap[item.idCustomField];
    if (!fieldName) continue;
    fields[fieldName] = extractCustomFieldValue(item);
  }

  return {
    card_id: card.id,
    card_name: card.name,
    card_url: card.url,
    description: card.desc,
    fields
  };
}

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/brand-card/:cardId", async (req, res) => {
  try {
    const brandCard = await getBrandCard(req.params.cardId);
    res.json({ ok: true, ...brandCard });
  } catch (error) {
    console.error("FULL TRELLO ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Error fetching card",
      details: error.response?.data || error.message
    });
  }
});

app.post("/generate-ad", async (req, res) => {
  try {
    const {
      cardId,
      platform,
      campaign_topic,
      offer,
      objective,
      size = "1080x1080"
    } = req.body;

    if (!cardId || !platform || !campaign_topic || !objective) {
      return res.status(400).json({
        ok: false,
        message: "Missing required fields: cardId, platform, campaign_topic, objective"
      });
    }

    const brandCard = await getBrandCard(cardId);

    const prompt = `
You are a senior advertising creative strategist.

Using the brand data below, generate an ad concept for this client.

BRAND CARD:
${JSON.stringify(brandCard, null, 2)}

REQUEST:
- Platform: ${platform}
- Campaign Topic: ${campaign_topic}
- Offer: ${offer || "None provided"}
- Objective: ${objective}
- Size: ${size}

Return valid JSON only in this exact structure:
{
  "headlines": ["...", "...", "..."],
  "subheads": ["...", "..."],
  "cta": "...",
  "visual_direction": "...",
  "layout_notes": "...",
  "image_prompt": "..."
}

Rules:
- Stay on brand
- Respect the tone and do_not_use guidance
- Use the most appropriate CTA based on the campaign
- Make the output usable for a designer
`;

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a precise ad strategist who returns only valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const content = openaiResponse.data.choices[0].message.content;
    const parsed = JSON.parse(content);

    res.json({
      ok: true,
      request: {
        cardId,
        platform,
        campaign_topic,
        offer,
        objective,
        size
      },
      brand: brandCard.fields,
      output: parsed
    });
  } catch (error) {
    console.error("GENERATE AD ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Error generating ad",
      details: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
