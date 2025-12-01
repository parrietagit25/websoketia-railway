// server.js
import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;

const AUTOMARKET_API_BASE =
  process.env.AUTOMARKET_API_BASE ||
  "https://automarketpanama.com/api/api_inventario.php";

const AUTOMARKET_TOKEN =
  process.env.AUTOMARKET_TOKEN || "cholitotecnico";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en Railway");
}

const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket server (bridge) running on PORT:", PORT);

// -----------------------------
// 1. Detección simple de marca
// -----------------------------
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

// -------------------------------------
// 2. Llamada real al API de Automarket
// -------------------------------------
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
    const resp = await fetch(url); // Node 18+ ya tiene fetch
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

// -----------------------------------
// 3. Bridge WebSocket <-→ Realtime VAPI
// -----------------------------------
wss.on("connection", (ws) => {
  console.log("🟢 Cliente conectado a Railway");

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type !== "input_text") {
        return;
      }

      const userText = data.text || "";
      console.log("📝 Pregunta del usuario:", userText);

      // 1) Inventario Automarket
      const autos = await fetchAutomarket(userText);

      // 2) Conectarse a OpenAI Realtime
      const openaiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1",
          },
        }
      );

      let fullText = "";

      openaiWs.on("open", () => {
        console.log("🔗 Conectado a OpenAI Realtime");

        // a) Configurar la sesión (solo texto)
        openaiWs.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              output_modalities: ["text"],
              // Instrucciones generales para TODO el chat
              instructions:
                "Eres un asesor de ventas de Automarket Panamá. " +
                "Respondes SIEMPRE en español, de forma profesional y clara. " +
                "Usa SOLO los vehículos que aparecen en el JSON de inventario que te envío " +
                "en el mensaje del usuario bajo el título 'Inventario Automarket (JSON)'. " +
                "Si la lista está vacía o hay error, dilo claramente y da recomendaciones generales.",
            },
          })
        );

        // b) Crear el item de conversación con la pregunta + inventario
        openaiWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    `Pregunta del cliente: ${userText}\n\n` +
                    `Inventario Automarket (JSON): ${JSON.stringify(autos)}`,
                },
              ],
            },
          })
        );

        // c) Pedir que el modelo genere una respuesta
        openaiWs.send(
          JSON.stringify({
            type: "response.create",
          })
        );
      });

      openaiWs.on("message", (event) => {
        let payload;
        try {
          payload = JSON.parse(event.toString());
        } catch (e) {
          console.error("⚠️ No se pudo parsear evento Realtime:", event.toString());
          return;
        }

        const type = payload.type;
        // console.log("🎧 Evento Realtime:", type);

        // 1) Streaming de texto
        if (type === "response.output_text.delta") {
          // En Realtime/Responses, "delta" suele ser el chunk de texto
          const delta = payload.delta;
          let chunk = "";

          if (typeof delta === "string") {
            chunk = delta;
          } else if (delta && typeof delta.text === "string") {
            chunk = delta.text;
          }

          if (chunk && ws.readyState === WebSocket.OPEN) {
            fullText += chunk;
            ws.send(
              JSON.stringify({
                type: "response_delta",
                text: chunk,
              })
            );
          }
        }

        // 2) Cuando ya terminó el texto
        else if (type === "response.output_text.done") {
          // Algunos eventos traen el texto completo en payload.text
          const finalText =
            (typeof payload.text === "string" && payload.text.length > 0)
              ? payload.text
              : fullText;

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "response_done",
                text: finalText,
              })
            );
          }
        }

        // 3) Errores de Realtime
        else if (type === "error") {
          console.error("❌ Error Realtime:", payload);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: payload.error?.message || "Error en Realtime VAPI",
              })
            );
          }
        }

        // 4) Opcional: log de cierre lógico
        else if (type === "response.done") {
          console.log("🧵 Conexión Realtime terminó la respuesta");
        }
      });

      openaiWs.on("close", () => {
        console.log("🧵 Conexión Realtime cerrada");
      });

      openaiWs.on("error", (err) => {
        console.error("❌ Error en WebSocket Realtime:", err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Error de conexión con OpenAI Realtime",
            })
          );
        }
      });
    } catch (error) {
      console.error("❌ Error procesando mensaje del cliente:", error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Error interno en el bridge",
          })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 Cliente desconectado");
  });
});
