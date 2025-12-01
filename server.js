import WebSocket, { WebSocketServer } from "ws";
import OpenAI from "openai";

const PORT = process.env.PORT || 8080;

// --- Iniciar servidor WebSocket ---
const wss = new WebSocketServer({ port: PORT });
console.log("🚀 WebSocket server running on PORT:", PORT);

console.log("🔑 OPENAI_API_KEY length:", OPENAI_API_KEY ? OPENAI_API_KEY.length : 0);

// --- Cliente OpenAI (Realtime REST → para enviar texto) ---
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
    console.error("❌ FALTA OPENAI_API_KEY en Railway");
}

wss.on("connection", (ws) => {
    console.log("🟢 Cliente conectado");

    ws.on("message", async (msg) => {
        try {
            const data = JSON.parse(msg);

            if (data.type === "input_text") {
                console.log("📩 Mensaje recibido:", data.text);

                // Llamada a OpenAI Realtime (REST)
                const completion = await client.responses.create({
                    model: "gpt-4o-realtime-preview",
                    input: data.text
                });

                const text = completion.output[0].content[0].text;

                ws.send(JSON.stringify({
                    type: "response",
                    text
                }));
            }

        } catch (error) {
            console.error("❌ Error:", error);
            ws.send(JSON.stringify({
                type: "error",
                message: error.message
            }));
        }
    });

    ws.on("close", () => console.log("🔌 Cliente desconectado"));
});
