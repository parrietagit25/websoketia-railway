// server.js
import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;

// ----------------- CONFIG AUTOMARKET -----------------
const AUTOMARKET_API_BASE =
  process.env.AUTOMARKET_API_BASE ||
  "https://automarketpanama.com/api/api_inventario.php";

const AUTOMARKET_TOKEN =
  process.env.AUTOMARKET_TOKEN || "cholitotecnico";

// ----------------- CONFIG OPENAI REALTIME -----------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en Railway");
}

const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

// ----------------- WEBSOCKET SERVER (RAILWAY) -----------------
const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket bridge running on PORT:", PORT);

// 1. Detectar marca en el texto
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

// 2. Llamada real al API de Automarket
async function fetchAutomarket(userText) {
  const brand = detectBrand(userText);

  let url = `${AUTOMARKET_API_BASE}?token=${encodeURIComponent(
    AUTOMARKET_TOKEN
  )}`;

  if (brand) {
    url += `&marca=${encodeURIComponent(brand)}`;
  }

  console.log("🚗 Llamando Automarket:", url);

  try {
    const resp = await fetch(url);
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

// 3. Bridge cliente <-> Realtime
wss.on("connection", (clientWs) => {
  console.log("🟢 Cliente conectado a Railway");

  // --- Abrimos 1 WebSocket a OpenAI Realtime para ESTE cliente ---
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // Helper para enviar eventos a OpenAI esperando a que abra
  const sendToOpenAI = (payload) => {
    const json = JSON.stringify(payload);

    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(json);
    } else if (openaiWs.readyState === WebSocket.CONNECTING) {
      openaiWs.once("open", () => openaiWs.send(json));
    } else {
      console.error("❌ No se puede enviar a OpenAI, estado:", openaiWs.readyState);
    }
  };

  // Cuando se abre Realtime → configuramos la sesión
  openaiWs.on("open", () => {
    console.log("🔗 Conectado a OpenAI Realtime");

    sendToOpenAI({
      type: "session.update",
      session: {
        modalities: ["text"], // luego añadimos audio
        instructions:
          "Eres un asesor de ventas de Automarket Panamá. " +
          "Respondes SIEMPRE en español, de forma profesional y clara. " +
          "Usa SOLO los vehículos que aparecen en el JSON de inventario " +
          "que te envío dentro del mensaje del usuario bajo el título " +
          "'Inventario Automarket (JSON)'. " +
          "Si la lista está vacía o hay error, dilo claramente y da recomendaciones generales.",
      },
    });
  });

  // Mensajes que vienen del navegador
  clientWs.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type !== "input_text") return;

      const userText = data.text || "";
      console.log("📝 Pregunta del usuario:", userText);

      // 1) Obtener inventario real
      const autos = await fetchAutomarket(userText);

      // 2) Construir texto combinado (pregunta + inventario)
      const combinedText =
        `Pregunta del cliente: ${userText}\n\n` +
        `Inventario Automarket (JSON): ${JSON.stringify(autos)}`;

      // 3) Enviar turno de usuario como conversation.item.create
      sendToOpenAI({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: combinedText,
            },
          ],
        },
      });

      // 4) Pedir una respuesta del modelo
      sendToOpenAI({
        type: "response.create",
      });
    } catch (err) {
      console.error("❌ Error procesando mensaje del cliente:", err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "error",
            message: err.message,
          })
        );
      }
    }
  });

  // Eventos que llegan desde Realtime
  let fullText = "";

  openaiWs.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch (e) {
      console.error("⚠️ No se pudo parsear evento Realtime:", raw.toString());
      return;
    }

    // Si quieres ver todo: console.log("🎧 Evento Realtime:", event.type);

    switch (event.type) {
      // Texto parcial (streaming)
      case "response.text.delta": {
        const delta = event.delta || "";
        if (delta && clientWs.readyState === WebSocket.OPEN) {
          fullText += delta;
          clientWs.send(
            JSON.stringify({
              type: "response_delta",
              text: delta,
            })
          );
        }
        break;
      }

      // Texto final
      case "response.text.done": {
        const finalText =
          typeof event.text === "string" && event.text.length > 0
            ? event.text
            : fullText;

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "response_done",
              text: finalText,
            })
          );
        }
        fullText = ""; // limpiar buffer
        break;
      }

      // Errores de Realtime
      case "error": {
        const message = event.error?.message || "Error en Realtime VAPI";
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
        // Otros eventos (session.created, response.created, response.done, etc.) los ignoramos por ahora
        break;
    }
  });

  // Cierres
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
