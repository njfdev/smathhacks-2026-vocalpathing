"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import useWebSocket from "react-use-websocket";

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
    : "wss://localhost:3000/ws";

function reducer(
  state: Record<string, any>,
  action: { type: string; id?: string; data?: any },
) {
  switch (action.type) {
    case "upsert":
      return {
        ...state,
        [action.id!]: { ...state[action.id!], ...action.data },
      };
    case "remove": {
      const next = { ...state };
      delete next[action.id!];
      return next;
    }
    default:
      return state;
  }
}

export default function Home() {
  const [clientData, dispatch] = useReducer(reducer, {});
  const [listeningEnabled, setListeningEnabled] = useState(false);
  const [triangulation, setTriangulation] = useState<{ x: number; y: number } | null>(null);
  const [micPositions, setMicPositions] = useState([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: 1, z: 0 },
  ]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<Map<string, number>>(new Map());
  const lastUpdateRef = useRef<Map<string, number>>(new Map());

  const enableListening = useCallback(() => {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    setListeningEnabled(true);
  }, []);

  const disableListening = useCallback(() => {
    audioContextRef.current?.close();
    audioContextRef.current = null;
    nextPlayTimeRef.current.clear();
    setListeningEnabled(false);
  }, []);

  const feedAudioChunk = useCallback(
    (clientId: string, deviceTimestamp: number, audioData: ArrayBuffer) => {
      // Update UI state (throttled to once per second) regardless of listening
      const wallNow = Date.now();
      const lastUpdate = lastUpdateRef.current.get(clientId) ?? 0;
      if (wallNow - lastUpdate > 1000) {
        lastUpdateRef.current.set(clientId, wallNow);
        dispatch({
          type: "upsert",
          id: clientId,
          data: {
            streaming: true,
            lastSeen: new Date().toLocaleTimeString(),
            deviceTimestamp,
          },
        });
      }

      const ctx = audioContextRef.current;
      if (!ctx) return;

      const samples = new Float32Array(audioData);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      let nextTime = nextPlayTimeRef.current.get(clientId) ?? now;
      if (nextTime < now) nextTime = now;

      source.start(nextTime);
      nextPlayTimeRef.current.set(clientId, nextTime + buffer.duration);
    },
    [],
  );

  const onMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "connect") {
            dispatch({
              type: "upsert",
              id: msg.from,
              data: {
                connected: true,
                lastSeen: new Date(msg.timestamp).toLocaleTimeString(),
              },
            });
          }
          if (msg.type === "data") {
            dispatch({
              type: "upsert",
              id: msg.from,
              data: {
                ...msg.payload,
                lastSeen: new Date(msg.timestamp).toLocaleTimeString(),
              },
            });
          }
          if (msg.type === "classification") {
            dispatch({
              type: "upsert",
              id: msg.from,
              data: {
                classification: {
                  topClass: msg.topClass,
                  topScore: msg.topScore,
                  scores: msg.scores,
                },
              },
            });
          }
          if (msg.type === "status") {
            dispatch({
              type: "upsert",
              id: msg.from,
              data: { modelStatus: msg.status },
            });
          }
          if (msg.type === "disconnect") {
            dispatch({ type: "remove", id: msg.from });
            nextPlayTimeRef.current.delete(msg.from);
          }
          if (msg.type === "triangulation") {
            setTriangulation({ x: msg.x, y: msg.y });
          }
        } catch {}
        return;
      }

      const blob = event.data as Blob;
      blob.arrayBuffer().then((buffer) => {
        const view = new DataView(buffer);
        const idLen = view.getUint8(0);
        const idBytes = new Uint8Array(buffer, 1, idLen);
        const clientId = new TextDecoder().decode(idBytes);
        const deviceTimestamp = view.getFloat64(1 + idLen, true);
        const audioData = buffer.slice(1 + idLen + 8);
        feedAudioChunk(clientId, deviceTimestamp, audioData);
      });
    },
    [feedAudioChunk],
  );

  const router = useRouter();

  const { sendMessage, readyState } = useWebSocket(WS_URL, {
    onMessage,
  });

  useEffect(() => {
    if (readyState === 1) {
      sendMessage(JSON.stringify({ type: "register", role: "dashboard" }));
    }
  }, [readyState]);

  const entries = Object.entries(clientData);

  // Build the SVG map coordinates from mic positions + triangulation result
  const buildMap = (W: number, H: number) => {
    const allPoints = [
      ...micPositions.map((p) => [p.x, p.y]),
      ...(triangulation ? [[triangulation.x, triangulation.y]] : []),
    ];
    let minX = Math.min(...allPoints.map((p) => p[0]));
    let maxX = Math.max(...allPoints.map((p) => p[0]));
    let minY = Math.min(...allPoints.map((p) => p[1]));
    let maxY = Math.max(...allPoints.map((p) => p[1]));

    // Add padding around the edges so dots aren't right on the border
    const padX = (maxX - minX || 1) * 0.3;
    const padY = (maxY - minY || 1) * 0.3;
    minX -= padX; maxX += padX;
    minY -= padY; maxY += padY;

    // Convert world coords to SVG pixels (flip Y so up = positive)
    const toSvg = (wx: number, wy: number) => ({
      x: ((wx - minX) / (maxX - minX)) * W,
      y: (1 - (wy - minY) / (maxY - minY)) * H,
    });
    return toSvg;
  };

  return (
    <div className="min-h-screen flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/20">
        <h1 className="text-white text-2xl font-bold">
          Marine Vocal Pathing Dashboard
        </h1>
        <div className="flex gap-3">
          <Button
            variant="solid"
            className="bg-rose-400 text-white"
            onPress={() => router.push("/recorder")}
          >
            Add Recorder
          </Button>
          <Button
            color={listeningEnabled ? "danger" : "secondary"}
            onPress={listeningEnabled ? disableListening : enableListening}
          >
            {listeningEnabled ? "Stop Listening" : "Start Listening"}
          </Button>
        </div>
      </header>

      {/* Main two-column layout */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">

        {/* Left column: map + mic position inputs */}
        <div className="flex flex-col gap-4 w-96 shrink-0">

          {/* Ocean map */}
          <div className="rounded-2xl overflow-hidden border-white border-2">
            {(() => {
              const W = 384;
              const H = 384;
              const toSvg = buildMap(W, H);
              return (
                <svg width={W} height={H}>
                  {/* Ocean background */}
                  <rect width={W} height={H} fill="#0c2a4a" />
                  {/* Subtle grid */}
                  {[0.25, 0.5, 0.75].map((t) => (
                    <g key={t}>
                      <line x1={t * W} y1={0} x2={t * W} y2={H} stroke="#1a4060" strokeWidth={1} />
                      <line x1={0} y1={t * H} x2={W} y2={t * H} stroke="#1a4060" strokeWidth={1} />
                    </g>
                  ))}
                  {/* Mic dots */}
                  {micPositions.map((pos, i) => {
                    const { x, y } = toSvg(pos.x, pos.y);
                    return (
                      <g key={i}>
                        <circle cx={x} cy={y} r={7} fill="white" opacity={0.9} />
                        <text x={x + 10} y={y + 4} fill="white" fontSize={11} fontFamily="monospace">
                          Mic {i}
                        </text>
                      </g>
                    );
                  })}
                  {/* Triangulated source dot */}
                  {triangulation && (() => {
                    const { x, y } = toSvg(triangulation.x, triangulation.y);
                    return (
                      <g>
                        <circle cx={x} cy={y} r={9} fill="#facc15" opacity={0.95} />
                        <text x={x + 12} y={y + 4} fill="#facc15" fontSize={11} fontFamily="monospace">
                          Source
                        </text>
                      </g>
                    );
                  })()}
                </svg>
              );
            })()}
          </div>

          {/* Numeric readout */}
          {triangulation && (
            <p className="font-mono text-white text-sm">
              X: {triangulation.x.toFixed(3)} m &nbsp; Y: {triangulation.y.toFixed(3)} m
            </p>
          )}

          {/* Mic position inputs */}
          <div className="p-4 border-white border-2 rounded-2xl">
            <p className="text-white font-bold mb-2">Microphone Positions (meters)</p>
            {micPositions.map((pos, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-white text-sm w-12">Mic {i}</span>
                {(["x", "y", "z"] as const).map((axis) => (
                  <label key={axis} className="flex items-center gap-1">
                    <span className="text-white text-xs uppercase">{axis}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={pos[axis]}
                      onChange={(e) =>
                        setMicPositions((prev) =>
                          prev.map((p, idx) =>
                            idx === i ? { ...p, [axis]: parseFloat(e.target.value) || 0 } : p
                          )
                        )
                      }
                      className="w-20 px-1 py-0.5 rounded text-black text-sm font-mono"
                    />
                  </label>
                ))}
              </div>
            ))}
            <Button
              size="sm"
              className="mt-1"
              onPress={() =>
                sendMessage(
                  JSON.stringify({
                    type: "set_mic_positions",
                    positions: micPositions.map((p) => [p.x, p.y, p.z]),
                  })
                )
              }
            >
              Apply
            </Button>
          </div>
        </div>

        {/* Right column: connected client cards */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {entries.length === 0 && (
            <p className="text-white font-bold text-lg">No connected clients.</p>
          )}

          {entries.map(([id, data]) => (
            <div key={id} className="p-4 border-white border-2 rounded-2xl">

              {/* Client header */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-white text-sm font-mono">{id}</p>
                <div className="flex items-center gap-3">
                  {data.streaming && (
                    <p className="text-sm font-bold text-green-400">Streaming audio</p>
                  )}
                  {data.modelStatus && (
                    <p className="text-sm font-bold text-yellow-300">
                      Model: {data.modelStatus === "loading_model" ? "Loading..." : "Ready"}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-white text-sm mb-3">Last seen: {data.lastSeen}</p>

              {/* Top 3 classification predictions */}
              {data.classification && (() => {
                const top3 = Object.entries(data.classification.scores as Record<string, number>)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3);
                const rankColors = ["#facc15", "#94a3b8", "#b45309"];
                const rankLabels = ["1st", "2nd", "3rd"];
                return (
                  <div className="mt-2 p-3 bg-blue-900/20 rounded-xl space-y-3">
                    <div className="mb-2">
                      <p className="text-white text-sm font-semibold">
                        Detected: {data.classification.topClass.replace(/_/g, " ")}
                      </p>
                      <p className="text-gray-400 text-sm">
                        Confidence: {(data.classification.topScore * 100).toFixed(1)}%
                      </p>
                    </div>
                    {top3.map(([name, score], rank) => (
                      <div key={name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold w-6" style={{ color: rankColors[rank] }}>
                              {rankLabels[rank]}
                            </span>
                            <span className="text-white text-sm font-semibold capitalize">
                              {name.replace(/_/g, " ")}
                            </span>
                          </div>
                          <span className="text-sm font-mono font-bold" style={{ color: rankColors[rank] }}>
                            {(score * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-2 rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(0, score * 100)}%`,
                              background: rankColors[rank],
                              opacity: 0.85,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
