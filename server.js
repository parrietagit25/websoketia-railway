// server.js
// Puente WebSocket entre cliente ↔ OpenAI Realtime ↔ Automarket (Railway)

const http = require("http");
const { WebSocketServer } = require("ws");
const WebSocket = require("ws");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT; // Railway asigna este puerto
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// URL de tu API PHP que devuelve inventario JSON
// Ejemplo: https://automarketpanama.com/api/inventario.php?marca=Hyundai&year=2025
const AUTOMARKET_API_URL =
  process.env.AUTOMARKET_API_URL ||
  "https://automarketpanama.com/api/inventario.php";

// ---------- Helpers ----------

// Llamar a la API de Automarket: ?marca=xxx&year=yyyy
function buscarInventario(marca, anio) {
  return new Promise((resolve, reject) => {
    const query = new url.URL(AUTOMARKET_API_URL);
    if (marca) query.searchParams.set("marca", marca);
    if (anio) query.searchParams.set("year", anio);

    https
      .get(query.toString(), (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            console.error("Error parseando JSON de Automarket:", err);
            resolve({
              error:
                "No se pudo leer la respuesta de Automarket. Inténtalo de nuevo.",
            });
          }
        });
      })
      .on("error", (err) => {
        console.error("Error llamando a Automarket:", err);
        resolve({
          error:
            "No se pudo conectar con el inventario real en este momento.",
        });
      });
  });
}

// Enviar mensaje JSON por WebSocket si está abierto
function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ---------- Servidor HTTP básico ----------
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Automarket WebSocket Realtime bridge está corriendo 🚀\n");
});

// ---------- Servidor WebSocket para clientes ----------
const wss = new WebSocketServer({ server });

wss.on("connection", (client) => {
  console.log("🔵 Cliente conectado al bridge Railway");

  if (!OPENAI_API_KEY) {
    client.send(
      JSON.stringify({
        type: "error",
        message:
          "OPENAI_API_KEY no está configurada en el servidor. Contacta a soporte.",
      })
    );
    client.close();
    return;
  }

  // ----- Conexión Realtime con OpenAI -----
  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4.1-realtime",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  // Cuando se abre la conexión con OpenAI, configuramos la sesión y las tools
  openaiWs.on("open", () => {
    console.log("✅ Conectado a OpenAI Realtime");

    // Configurar sesión con una herramienta buscar_inventario
    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions:
          "Eres un asesor de ventas de Automarket Panamá. " +
          "Cuando el usuario pregunte por vehículos específicos, utiliza la herramienta 'buscar_inventario' " +
          "para consultar el inventario real. Responde siempre en español neutro.",
        tools: [
          {
            type: "function",
            name: "buscar_inventario",
            description:
              "Busca vehículos disponibles en el inventario real de Automarket Panamá, filtrando por marca y año.",
            parameters: {
              type: "object",
              properties: {
                marca: {
                  type: "string",
                  description: "Marca del vehículo, por ejemplo: Hyundai, Kia.",
                },
                anio: {
                  type: "integer",
                  description: "Año del vehículo, por ejemplo: 2020, 2025.",
                },
              },
              required: ["marca"],
            },
          },
        ],
      },
    };

    safeSend(openaiWs, sessionUpdate);
  });

  // Mensajes que vienen de OpenAI
  openaiWs.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      // Si no es JSON, lo reenviamos tal cual al cliente
      if (client.readyState === WebSocket.OPEN) client.send(data);
      return;
    }

    // Detectar tool calls de Realtime
    if (
      msg.type === "response.output_item.added" &&
      msg.item &&
      msg.item.type === "tool_call" &&
      msg.item.name === "buscar_inventario"
    ) {
      const toolCall = msg.item;
      const responseId = msg.response_id;
      const outputIndex = msg.output_index;
      const callId = toolCall.call_id;

      console.log("🛠 Tool call recibida:", toolCall);

      // Argumentos de la tool
      let args = {};
      try {
        args = JSON.parse(toolCall.arguments || "{}");
      } catch (err) {
        console.error("Error parseando argumentos de tool:", err);
      }

      const marca = args.marca || "";
      const anio = args.anio || null;

      // Llamar a la API de Automarket
      const inventario = await buscarInventario(marca, anio);

      // Enviar tool_output de vuelta a OpenAI
      const toolOutputEvent = {
        type: "response.tool_output",
        response_id: responseId,
        output_index: outputIndex,
        call_id: callId,
        name: "buscar_inventario",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(inventario),
          },
        ],
      };

      console.log("📤 Enviando tool_output a OpenAI");
      safeSend(openaiWs, toolOutputEvent);
      return;
    }

    // Para cualquier otro evento de OpenAI, lo reenviamos al cliente
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });

  openaiWs.on("close", () => {
    console.log("🔌 Conexión con OpenAI cerrada");
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  openaiWs.on("error", (err) => {
    console.error("❌ Error en WebSocket de OpenAI:", err);
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "error",
          message: "Error conectando con OpenAI Realtime",
        })
      );
      client.close();
    }
  });

  // Mensajes desde el cliente → se mandan a OpenAI
  client.on("message", (message) => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      // Puedes enviar directamente eventos Realtime desde el cliente
      openaiWs.send(message);
    }
  });

  client.on("close", () => {
    console.log("🔴 Cliente desconectado");
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  client.on("error", (err) => {
    console.error("❌ Error en WebSocket del cliente:", err);
  });
});

// ---------- Iniciar servidor ----------
server.listen(PORT, () => {
  console.log("🚀 Bridge Realtime + Automarket escuchando en puerto", PORT);
});
