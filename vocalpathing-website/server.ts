import { createServer } from "https";
import { parse } from "url";
import next from "next";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { WebSocketServer } from "ws";
import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const classifierProcesses = new Map<string, ChildProcess>();

mkdirSync("recordings", { recursive: true });

function sendToDashboards(message: string | Buffer) {
  for (const [, info] of clients) {
    if (info.role === "dashboard" && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(message);
    }
  }
}

function spawnClassifier(clientId: string) {
  const mlDir = path.resolve(__dirname, "..", "ml_stuff");
  const scriptPath = path.join(mlDir, "classify_stream.py");
  const pythonPath = path.resolve(__dirname, "..", "venv", "bin", "python3");
  const child = spawn(
    pythonPath,
    [scriptPath, "--sr", "48000", "--client-id", clientId],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  console.log(
    `[classifier] Spawned Python process (pid=${child.pid}) for client ${clientId}`,
  );

  // Prevent EPIPE from crashing the server if Python dies
  child.stdin!.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return;
    console.error(`[classifier:${clientId}] stdin error:`, err);
  });

  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    try {
      const result = JSON.parse(line);
      console.log(
        `[classifier] ${clientId}: ${result.type}`,
        result.topClass ?? result.status ?? "",
      );
      sendToDashboards(JSON.stringify(result));
    } catch (e) {
      console.error(
        `[classifier] Failed to parse output from ${clientId}:`,
        line,
      );
    }
  });

  child.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      console.error(`[classifier:${clientId}] ${text}`);
    }
  });

  child.on("exit", (code, signal) => {
    console.log(
      `[classifier] Python process for ${clientId} exited (code=${code}, signal=${signal})`,
    );
    classifierProcesses.delete(clientId);
  });

  classifierProcesses.set(clientId, child);
  return child;
}

function killClassifier(clientId: string) {
  const child = classifierProcesses.get(clientId);
  if (child) {
    console.log(
      `[classifier] Killing Python process (pid=${child.pid}) for client ${clientId}`,
    );
    child.stdin?.end();
    child.kill();
    classifierProcesses.delete(clientId);
  }
}

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

        killClassifier(clientId);

        const notice = JSON.stringify({
          type: "disconnect",
          from: clientId,
        });
        sendToDashboards(notice);
      }
      if (clientId) clients.delete(clientId);
    });

    ws.on("message", (message: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (role === "client" && clientId) {
          // First 8 bytes = Float64LE device timestamp, rest = PCM audio
          const buf = Buffer.from(message);
          const deviceTimestamp = buf.readDoubleLE(0);
          const audioData = buf.subarray(8);

          if (!audioBuffers.has(clientId)) audioBuffers.set(clientId, []);
          audioBuffers.get(clientId)!.push(Buffer.from(audioData));

          // Envelope: [idLen(1), id(N), timestamp(8), audio(...)]
          const idBuf = Buffer.from(clientId, "utf-8");
          const header = Buffer.alloc(1);
          header.writeUInt8(idBuf.length, 0);
          const tsBuf = Buffer.alloc(8);
          tsBuf.writeDoubleLE(deviceTimestamp, 0);
          const envelope = Buffer.concat([header, idBuf, tsBuf, audioData]);
          sendToDashboards(envelope);

          // Pipe only the raw PCM audio (no timestamp) to the classifier
          const child = classifierProcesses.get(clientId);
          if (child && child.stdin && !child.stdin.destroyed) {
            child.stdin.write(audioData);
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
            spawnClassifier(clientId);

            const notice = JSON.stringify({
              type: "connect",
              from: clientId,
              timestamp: Date.now(),
            });
            sendToDashboards(notice);
          }
        }

        if (role === "client" && msg.payload) {
          const envelope = JSON.stringify({
            type: "data",
            from: clientId ?? crypto.randomUUID(),
            timestamp: Date.now(),
            payload: msg.payload,
          });
          sendToDashboards(envelope);
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
