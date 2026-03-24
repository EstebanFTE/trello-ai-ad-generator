app.get("/generate-and-save/:cardId", async (req, res) => {
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

    // Format content to save into Trello
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

    // Update card description
    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      null,
      {
        params: {
          key: process.env.TRELLO_KEY,
          token: process.env.TRELLO_TOKEN,
          desc: content
        }
      }
    );

    res.json({
      ok: true,
      message: "Ad generated and saved to Trello",
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
