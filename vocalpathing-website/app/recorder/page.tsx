"use client";

import { useWebSocketWrapper } from "@/hooks/ws";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReadyState } from "react-use-websocket";
import { v4 as uuidv4 } from "uuid";

const CLIENT_ID = uuidv4();

export default function Recorder() {
  const router = useRouter();

  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null,
  );

  const { sendJsonMessage, readyState } = useWebSocketWrapper(() => {});

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({ type: "register", role: "client", id: CLIENT_ID });
    }
  }, [readyState]);

  const sendMessage = useCallback(() => {
    sendJsonMessage({
      payload: {
        msg: "test",
      },
    });
  }, [sendJsonMessage]);

  // Function to start recording
  const getRecorder = () => {
    setIsRecording(true);

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);
    });
  };

  useEffect(() => {
    if (mediaRecorder == null) {
      getRecorder();
    }
  }, [mediaRecorder]);

  const startRecording = () => {
    if (mediaRecorder != null) {
      setIsRecording(true);
      mediaRecorder.start();
    } else {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder != null) {
      mediaRecorder.stop();
    }
    setIsRecording(false);
  };

  return (
    <div>
      <h1>This is a recording device.</h1>
      <Button onPress={() => router.push("/")}>Return to Dashboard</Button>

      <Button
        className="mt-8"
        onPress={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? "Stop" : "Start"} Recording
      </Button>

      <Button onPress={sendMessage}>Send Test</Button>
    </div>
  );
}
