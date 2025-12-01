// server.js
// Servidor WebSocket simple para Railway

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// Servidor HTTP básico para pruebas
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running 🚀\n");
});

// Crear WebSocket server usando el mismo servidor HTTP
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("🔵 Nuevo cliente conectado");

  ws.send("👋 Bienvenido al servidor WebSocket en Railway!");

  ws.on("message", (msg) => {
    console.log("📩 Mensaje recibido:", msg.toString());
    ws.send("Echo: " + msg.toString());
  });

  ws.on("close", () => {
    console.log("🔴 Cliente desconectado");
  });
});

server.listen(PORT, () => {
  console.log("🚀 Servidor escuchando en el puerto", PORT);
});
