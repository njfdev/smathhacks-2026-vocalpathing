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
    (clientId: string, audioData: ArrayBuffer) => {
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

      // Update UI state (throttled to once per second)
      const wallNow = Date.now();
      const lastUpdate = lastUpdateRef.current.get(clientId) ?? 0;
      if (wallNow - lastUpdate > 1000) {
        lastUpdateRef.current.set(clientId, wallNow);
        dispatch({
          type: "upsert",
          id: clientId,
          data: { streaming: true, lastSeen: new Date().toLocaleTimeString() },
        });
      }
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
        } catch {}
        return;
      }

      // Binary message = PCM audio data
      const blob = event.data as Blob;
      blob.arrayBuffer().then((buffer) => {
        const view = new DataView(buffer);
        const idLen = view.getUint8(0);
        const idBytes = new Uint8Array(buffer, 1, idLen);
        const clientId = new TextDecoder().decode(idBytes);
        const audioData = buffer.slice(1 + idLen);
        feedAudioChunk(clientId, audioData);
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

  return (
    <div className="m-8">
      <h1 className="text-white text-3xl font-bold mb-4">
        Marine Vocal Pathing Dashboard
      </h1>

      <Button
        variant="solid"
        className="bg-rose-400 text-white"
        onPress={() => router.push("/recorder")}
      >
        Make this device a recorder
      </Button>

      <div></div>

      <Button
        className="my-4"
        color={`${listeningEnabled ? "danger" : "secondary"}`}
        onPress={listeningEnabled ? disableListening : enableListening}
      >
        {listeningEnabled ? "Stop Listening" : "Start Listening"}
      </Button>

      {entries.length === 0 && (
        <p className="text-white font-bold text-lg">No connected clients.</p>
      )}

      {entries.map(([id, data]) => (
        <div key={id} className="p-4 border-white border-2 rounded-2xl mb-2">
          <p className="text-white text-sm">
            Client: <span className="font-mono">{id}</span>
          </p>
          <p className="text-white text-sm">Last seen: {data.lastSeen}</p>
          {data.streaming && (
            <p className="text-sm font-bold text-green-400">Streaming audio</p>
          )}
          {data.modelStatus && (
            <p className="text-sm font-bold text-yellow-300">
              Model:{" "}
              {data.modelStatus === "loading_model" ? "Loading..." : "Ready"}
            </p>
          )}
          {data.classification && (
            <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
              <p className="text-sm font-semibold">
                Detected: {data.classification.topClass.replace(/_/g, " ")}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Confidence: {(data.classification.topScore * 100).toFixed(1)}%
              </p>
              <div className="mt-1 space-y-0.5">
                {Object.entries(
                  data.classification.scores as Record<string, number>,
                )
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3)
                  .map(([name, score]) => (
                    <div key={name} className="flex items-center gap-2 text-xs">
                      <span className="w-36 truncate">
                        {name.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded h-2">
                        <div
                          className="bg-blue-500 h-2 rounded"
                          style={{ width: `${score * 100}%` }}
                        />
                      </div>
                      <span className="w-12 text-right">
                        {(score * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
