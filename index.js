import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_TEST_CARD_ID = "5f1b1bf3f54ac166cbdd50d8";

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

async function generateAdFromBrand(brandCard, requestData) {
  const prompt = `
You are a senior advertising creative strategist.

Using the brand data below, generate an ad concept for this client.

BRAND CARD:
${JSON.stringify(brandCard, null, 2)}

REQUEST:
- Platform: ${requestData.platform}
- Campaign Topic: ${requestData.campaign_topic}
- Offer: ${requestData.offer || "None provided"}
- Objective: ${requestData.objective}
- Size: ${requestData.size || "1080x1080"}

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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return JSON.parse(openaiResponse.data.choices[0].message.content);
}

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/brand-card/:cardId", async (req, res) => {
  try {
    const brandCard = await getBrandCard(req.params.cardId);

    res.json({
      ok: true,
      ...brandCard
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

app.get("/generate-ad-test/:cardId", async (req, res) => {
  try {
    const { cardId } = req.params;

    const brandCard = await getBrandCard(cardId);

    const requestData = {
      platform: "social",
      campaign_topic: "spring sales event",
      offer: "shop our inventory",
      objective: "drive vehicle sales",
      size: "1080x1080"
    };

    const output = await generateAdFromBrand(brandCard, requestData);

    res.json({
      ok: true,
      request: requestData,
      brand: brandCard.fields,
      output
    });
  } catch (error) {
    console.error("GENERATE TEST ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Error generating test ad",
      details: error.response?.data || error.message
    });
  }
});

app.get("/generate-and-save/:cardId", async (req, res) => {
  try {
    const { cardId } = req.params;

    if (cardId !== ALLOWED_TEST_CARD_ID) {
      return res.status(403).json({
        ok: false,
        message: "This route is locked to the Raabe test card only."
      });
    }

    const brandCard = await getBrandCard(cardId);

    const requestData = {
      platform: "social",
      campaign_topic: "spring sales event",
      offer: "shop our inventory",
      objective: "drive vehicle sales",
      size: "1080x1080"
    };

    const output = await generateAdFromBrand(brandCard, requestData);

    const content = `

=== AI GENERATED AD ===

HEADLINES:
- ${output.headlines.join("\n- ")}

SUBHEADS:
- ${output.subheads.join("\n- ")}

CTA:
${output.cta}

VISUAL DIRECTION:
${output.visual_direction}

LAYOUT NOTES:
${output.layout_notes}

IMAGE PROMPT:
${output.image_prompt}
`;

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      null,
      {
        params: {
          key: process.env.TRELLO_KEY,
          token: process.env.TRELLO_TOKEN,
          desc: `${brandCard.description}${content}`
        }
      }
    );

    res.json({
      ok: true,
      message: "Ad generated and appended to Trello card",
      cardId,
      output
    });
  } catch (error) {
    console.error("SAVE ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Error generating and saving",
      details: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
