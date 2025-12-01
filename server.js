import WebSocket, { WebSocketServer } from "ws";
import OpenAI from "openai";

const PORT = process.env.PORT || 8080;

// --- Cliente OpenAI ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ FALTA OPENAI_API_KEY en Railway");
} else {
  console.log(
    "🔑 OPENAI_API_KEY length:",
    process.env.OPENAI_API_KEY.length
  );
}

// --- Iniciar servidor WebSocket ---
const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket server running on PORT:", PORT);

wss.on("connection", (ws) => {
  console.log("🟢 Cliente conectado");

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "input_text") {
        console.log("📩 Mensaje recibido:", data.text);

        // Llamada a OpenAI por REST (NO realtime)
        const completion = await client.responses.create({
          model: "gpt-4o-mini",          // 👈 modelo válido para REST
          input: data.text,
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
