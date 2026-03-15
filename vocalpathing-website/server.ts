import { createServer } from "https";
import { parse } from "url";
import next from "next";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
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
const audioBuffers = new Map<string, Buffer[]>();

mkdirSync("recordings", { recursive: true });

app.prepare().then(() => {
  const server = createServer(options, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!, true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws) => {
    let role: string | null = null;
    let clientId: string | null = null;

    ws.on("close", () => {
      if (role === "client" && clientId) {
        const chunks = audioBuffers.get(clientId);
        if (chunks && chunks.length > 0) {
          const allAudio = Buffer.concat(chunks);
          writeFileSync(`recordings/${clientId}.pcm`, allAudio);
          console.log(`Saved recording: recordings/${clientId}.pcm`);
          audioBuffers.delete(clientId);
        }

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

    ws.on("message", (message: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (role === "client" && clientId) {
          if (!audioBuffers.has(clientId)) audioBuffers.set(clientId, []);
          audioBuffers.get(clientId)!.push(Buffer.from(message));

          const idBuf = Buffer.from(clientId, "utf-8");
          const header = Buffer.alloc(1);
          header.writeUInt8(idBuf.length, 0);
          const envelope = Buffer.concat([header, idBuf, message]);

          for (const [, info] of clients) {
            if (
              info.role === "dashboard" &&
              info.ws.readyState === WebSocket.OPEN
            ) {
              info.ws.send(envelope);
            }
          }
        }
        return;
      }

      try {
        const msg = JSON.parse(message.toString());

        if (msg.type === "register") {
          role = msg.role;
          clientId = msg.id;
          clients.set(clientId, { role, ws });

          if (role === "client" && clientId) {
            const notice = JSON.stringify({
              type: "connect",
              from: clientId,
              timestamp: Date.now(),
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
        }

        if (role === "client" && msg.payload) {
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
