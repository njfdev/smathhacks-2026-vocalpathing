"use client";

import { useWebSocketWrapper } from "@/hooks/ws";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AiFillPauseCircle,
  AiOutlinePlayCircle,
  AiOutlineStop,
} from "react-icons/ai";
import { ReadyState } from "react-use-websocket";
import { v4 as uuidv4 } from "uuid";

const CLIENT_ID = uuidv4();

export default function Recorder() {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [syncTime, setSyncTime] = useState(0);
  const [syncFrame, setSyncFrame] = useState(-1);

  const { sendMessage, sendJsonMessage, readyState } = useWebSocketWrapper(
    () => {},
  );

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({ type: "register", role: "client", id: CLIENT_ID });
    }
  }, [readyState]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (readyState === ReadyState.OPEN) {
        const pcm = new Float32Array(e.inputBuffer.getChannelData(0));
        if (syncFrame == -1) {
          setSyncFrame(0);
          setSyncTime(e.timeStamp);
        }
        sendMessage(pcm.buffer);
      }
    };

    // Connect through zero-gain node to avoid feedback
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);

    audioContextRef.current = ctx;
    streamRef.current = stream;
    setIsRecording(true);
  };

  const stopRecording = () => {
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsRecording(false);
    setSyncFrame(-1);
  };

  return (
    <div className="flex items-center flex-col m-8">
      <h1 className="text-5xl font-extrabold text-white">Ocean Monitor</h1>

      <Button
        className="mt-8 w-48 h-48 text-white rounded-full"
        onPress={isRecording ? stopRecording : startRecording}
        isIconOnly={true}
        variant="light"
        startContent={
          isRecording ? (
            <AiFillPauseCircle size={600} />
          ) : (
            <AiOutlinePlayCircle size={600} />
          )
        }
      ></Button>

      <Button
        className="mt-16 w-[16rem] bg-rose-400 text-white font-bold"
        variant="solid"
        size="lg"
        onPress={() => router.push("/")}
      >
        Return to Dashboard
      </Button>
    </div>
  );
}
