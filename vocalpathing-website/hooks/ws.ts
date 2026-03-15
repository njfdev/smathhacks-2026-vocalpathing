import useWebSocket from "react-use-websocket";

function getWsUrl() {
  if (typeof window === "undefined") return "wss://localhost:3000/ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
const WS_URL = getWsUrl();

export function useWebSocketWrapper(onMessage: (data: any) => void) {
  return useWebSocket(WS_URL, {
    onMessage,
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: (attempt) => attempt * 1000,
  });
}
