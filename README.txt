Websoketia - Railway WebSocket Server
====================================

Pasos para usar este proyecto en Railway:

1. Sube este proyecto a un repositorio en GitHub.
2. Entra a https://railway.app y crea un nuevo proyecto "Deploy from GitHub".
3. Selecciona el repositorio donde subiste estos archivos.
4. Railway detectará NodeJS automáticamente y usará el comando:
   npm install
   npm start
5. Cuando el servicio esté "Running", tendrás una URL como:
   https://<tu-app>.up.railway.app

   El WebSocket estará en:
   wss://<tu-app>.up.railway.app

Prueba desde la consola del navegador:

   let ws = new WebSocket("wss://<tu-app>.up.railway.app");
   ws.onopen = () => console.log("Conectado!");
   ws.onmessage = (m) => console.log("Mensaje:", m.data);
