// server.js
// Servidor WebSocket simple para Railway

const http = require("http");
const { WebSocketServer } = require("ws");

// 🚨 IMPORTANTE: en Railway SIEMPRE usar process.env.PORT
const PORT = process.env.PORT;

// HTTP básico para comprobar que vive
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running 🚀\n");
});

// WebSocket montado sobre el server HTTP
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
