import { createServer } from "https";
import { parse } from "url";
import next from "next";
import { readFileSync } from "fs";
import { WebSocketServer } from "ws";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const options = {
  key: readFileSync("localhost-key.pem"),
  cert: readFileSync("localhost.pem"),
};

const clients = new Map();

app.prepare().then(() => {
  const server = createServer(options, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // create websocket Server
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!, true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // Let Next.js handle its own HMR WebSocket upgrades
  });

  wss.on("connection", (ws) => {
    let role: string | null = null;
    let clientId: string | null = null;

    ws.on("close", () => {
      if (role === "client" && clientId) {
        const notice = JSON.stringify({
          type: "disconnect",
          from: clientId,
        });
        for (const [, info] of clients) {
          if (
            info.role === "dashboard" &&
            info.ws.readyState === WebSocket.OPEN
          ) {
            info.ws.send(notice);
          }
        }
      }
      if (clientId) clients.delete(clientId);
    });

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.type === "register") {
          role = msg.role;
          clientId = msg.id;
          clients.set(clientId, { role, ws });
        }

        if (role === "client") {
          const envelope = JSON.stringify({
            type: "data",
            from: clientId ?? crypto.randomUUID(),
            timestamp: Date.now(),
            payload: msg.payload,
          });
          for (const [, info] of clients) {
            if (
              info.role === "dashboard" &&
              info.ws.readyState === WebSocket.OPEN
            ) {
              info.ws.send(envelope);
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    });
  });

  server.listen(port, "0.0.0.0");
  console.log(
    `> Server listening at https://0.0.0.0:${port} as ${
      dev ? "development" : process.env.NODE_ENV
    }`,
  );
});
