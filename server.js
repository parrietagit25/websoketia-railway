// server.js
import WebSocket, { WebSocketServer } from "ws";
import OpenAI from "openai";

const PORT = process.env.PORT || 8080;

const AUTOMARKET_API_BASE =
  process.env.AUTOMARKET_API_BASE ||
  "https://automarketpanama.com/api/api_inventario.php";

const AUTOMARKET_TOKEN =
  process.env.AUTOMARKET_TOKEN || "cholitotecnico";

const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket server running on PORT:", PORT);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en Railway");
}

// --- Detección simple de marca en el texto ---
function detectBrand(text) {
  const brands = [
    "hyundai", "kia", "toyota", "honda", "nissan", "mazda", "chevrolet",
    "ford", "suzuki", "mitsubishi", "jeep", "bmw", "mercedes", "audi",
    "volkswagen", "vw", "renault", "peugeot", "chery", "geely", "baic", "jmc"
  ];

  const low = text.toLowerCase();
  for (const b of brands) {
    if (low.includes(b)) return b;
  }
  return null;
}

// --- Llamada real al API de Automarket ---
async function fetchAutomarket(userText) {
  const brand = detectBrand(userText); // ej: "hyundai"

  let url = `${AUTOMARKET_API_BASE}?token=${encodeURIComponent(
    AUTOMARKET_TOKEN
  )}`;

  if (brand) {
    url += `&marca=${encodeURIComponent(brand)}`;
  }

  console.log("🚗 Llamando Automarket:", url);

  try {
    const resp = await fetch(url); // Node 22 ya trae fetch
    const json = await resp.json(); // { result: [...] }

    return {
      brand: brand ? brand.toUpperCase() : null,
      ...json,
    };
  } catch (err) {
    console.error("❌ Error llamando a Automarket:", err);
    return { error: "No se pudo conectar con Automarket" };
  }
}

// --- WebSocket ---
wss.on("connection", (ws) => {
  console.log("🟢 Cliente conectado");

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "input_text") {
        console.log("📝 Pregunta del usuario:", data.text);

        // 1. Inventario real Automarket
        const autos = await fetchAutomarket(data.text);

        // 2. Llamada a OpenAI con la pregunta + inventario Automarket
        const completion = await client.responses.create({
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "Eres un asesor de ventas de Automarket Panamá. " +
                "Usa SOLO los vehículos que aparecen en el inventario JSON 'result'. " +
                "Si la lista está vacía o hay error, dilo claramente y da recomendaciones generales.",
            },
            {
              role: "user",
              content:
                `Pregunta del cliente: ${data.text}\n\n` +
                `Inventario Automarket (JSON): ${JSON.stringify(autos)}`,
            },
          ],
        });

        const text = completion.output[0].content[0].text;

        ws.send(
          JSON.stringify({
            type: "response",
            text,
          })
        );
      }
    } catch (error) {
      console.error("❌ Error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: error.message,
        })
      );
    }
  });

  ws.on("close", () => console.log("🔌 Cliente desconectado"));
});
