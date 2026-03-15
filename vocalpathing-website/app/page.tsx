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
      return { ...state, [action.id!]: action.data };
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
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>

      <div className="flex gap-2 mb-6">
        <Button onPress={() => router.push("/recorder")}>
          Start Recording
        </Button>
        {!listeningEnabled ? (
          <Button color="primary" onPress={enableListening}>
            Start Listening
          </Button>
        ) : (
          <Button color="danger" onPress={disableListening}>
            Stop Listening
          </Button>
        )}
      </div>

      {entries.length === 0 && <p>No connected clients.</p>}

      {entries.map(([id, data]) => (
        <div key={id} className="p-4 border rounded mb-2">
          <p className="font-mono text-sm">Client: {id.slice(0, 8)}...</p>
          <p className="text-sm">Last seen: {data.lastSeen}</p>
          {data.streaming && (
            <p className="text-sm text-green-500">Streaming audio</p>
          )}
        </div>
      ))}
    </div>
  );
}
