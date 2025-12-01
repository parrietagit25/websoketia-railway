import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT;  // Railway lo asigna

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running.");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("Cliente conectado");
  ws.send("Bienvenido al WebSocket!");

  ws.on("message", (msg) => {
    console.log("Mensaje recibido:", msg.toString());
    ws.send("Eco: " + msg);
  });

  ws.on("close", () => {
    console.log("Cliente desconectado");
  });
});

server.listen(PORT, () => {
  console.log("Servidor WebSocket escuchando en puerto", PORT);
});
