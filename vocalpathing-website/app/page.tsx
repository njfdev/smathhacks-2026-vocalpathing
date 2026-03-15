"use client";

import { Button } from "@heroui/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer } from "react";
import useWebSocket from "react-use-websocket";

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
    : "wss://localhost:3000/ws";

function reducer(state: any, action: any) {
  switch (action.type) {
    case "upsert":
      return { ...state, [action.id]: action.data };
    case "remove":
      const next = { ...state };
      delete next[action.id];
      return next;
    default:
      return state;
  }
}

export default function Home() {
  const [clientData, dispatch] = useReducer(reducer, {});

  const onMessage = useCallback((event: any) => {
    const msg = JSON.parse(event.data);

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
    }
  }, []);

  const router = useRouter();

  const { sendMessage, lastMessage, readyState } = useWebSocket(WS_URL, {
    onMessage,
  });

  useEffect(() => {
    if (readyState === 1) {
      sendMessage(JSON.stringify({ type: "register", role: "dashboard" }));
    }
  }, [readyState]);

  const entries = Object.entries(clientData);

  return (
    <div>
      <h1>Dashboard</h1>
      <Button onPress={() => router.push("/recorder")}>Start Recording</Button>
      <div>{JSON.stringify(entries)}</div>
    </div>
  );
}
