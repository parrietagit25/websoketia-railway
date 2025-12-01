// server.js (versión usando Realtime API)
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

const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket server (bridge) running on PORT:", PORT);

// --- Detección simple de marca en el texto ---
function detectBrand(text) {
  const brands = [
    "hyundai",
    "kia",
    "toyota",
    "honda",
    "nissan",
    "mazda",
    "chevrolet",
    "ford",
    "suzuki",
    "mitsubishi",
    "jeep",
    "bmw",
    "mercedes",
    "audi",
    "volkswagen",
    "vw",
    "renault",
    "peugeot",
    "chery",
    "geely",
    "baic",
    "jmc",
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

// --- WebSocket principal (cliente <-> Railway) ---
wss.on("connection", (clientWs) => {
  console.log("🟢 Cliente conectado a Railway");

  // 1) Abrimos conexión a OpenAI Realtime
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openaiWs.on("open", () => {
    console.log("🔗 Conectado a OpenAI Realtime");

    // Configuramos la sesión (instrucciones, solo texto)
    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text"],
          instructions:
            "Eres un asesor de ventas de Automarket Panamá. " +
            "Responde SIEMPRE en español. " +
            "Usa SOLO los vehículos que aparezcan en el inventario JSON que te envío. " +
            "Si la lista está vacía o hay error, dilo claramente y da recomendaciones generales.",
        },
      })
    );
  });

  // 2) Mensajes que vienen del navegador
  clientWs.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "input_text") {
        const userText = data.text || "";
        console.log("📝 Pregunta del usuario:", userText);

        // a) Inventario real Automarket
        const autos = await fetchAutomarket(userText);

        // b) Creamos el "mensaje del usuario" dentro de la conversación Realtime
        const content =
          `Pregunta del cliente: ${userText}\n\n` +
          `Inventario Automarket (JSON): ${JSON.stringify(autos)}`;

        openaiWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              role: "user",
              // texto de entrada
              input_text: [
                {
                  type: "input_text",
                  text: content,
                },
              ],
            },
          })
        );

        // c) Disparamos la respuesta del modelo
        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              // modalities: ["text"] // por defecto ya es texto
            },
          })
        );
      }
    } catch (err) {
      console.error("❌ Error procesando mensaje del cliente:", err);
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: err.message,
        })
      );
    }
  });

  // 3) Eventos que vienen desde OpenAI Realtime
  openaiWs.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch (e) {
      console.error("⚠️ No se pudo parsear evento Realtime:", raw.toString());
      return;
    }

    // Para debug:
    // console.log("🎧 Evento Realtime:", event.type);

    switch (event.type) {
      // Texto parcial (streaming)
      case "response.output_text.delta": {
        const delta = event.delta || "";
        if (delta && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "response_delta",
              delta,
            })
          );
        }
        break;
      }

      // Texto final para esa parte
      case "response.output_text.done": {
        const text = event.text || "";
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "response_done",
              text,
            })
          );
        }
        break;
      }

      // Errores de la API Realtime
      case "response.failed":
      case "error": {
        const message =
          event.error?.message || "Error en la respuesta Realtime";
        console.error("❌ Error Realtime:", message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "error",
              message,
            })
          );
        }
        break;
      }

      default:
        // Otros eventos los ignoramos por ahora
        break;
    }
  });

  // 4) Manejo de cierres
  clientWs.on("close", () => {
    console.log("🔌 Cliente desconectado");
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  openaiWs.on("close", () => {
    console.log("🧵 Conexión Realtime cerrada");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  openaiWs.on("error", (err) => {
    console.error("❌ Error en WebSocket Realtime:", err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: "Error en la conexión con el modelo",
        })
      );
    }
  });
});
