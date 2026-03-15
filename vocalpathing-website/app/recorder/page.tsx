"use client";

import { useWebSocketWrapper } from "@/hooks/ws";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AiFillPauseCircle, AiFillPlayCircle } from "react-icons/ai";
import { ReadyState } from "react-use-websocket";
import { v4 as uuidv4 } from "uuid";

const CLIENT_ID = uuidv4();

export default function Recorder() {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const syncRef = useRef<{ wallTime: number; frame: number } | null>(null);

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

    await ctx.audioWorklet.addModule("/audio-processor.js");

    const source = ctx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(ctx, "timestamp-processor");

    syncRef.current = {
      wallTime: performance.timeOrigin + performance.now(),
      frame: -1,
    };

    workletNode.port.onmessage = (e) => {
      const {
        pcm,
        frame,
        sampleRate: sr,
      } = e.data as {
        pcm: Float32Array;
        frame: number;
        sampleRate: number;
      };

      if (readyState !== ReadyState.OPEN) return;

      if (syncRef.current && syncRef.current.frame === -1) {
        syncRef.current.frame = frame;
      }

      const sync = syncRef.current!;
      const deviceTimestamp =
        sync.wallTime + ((frame - sync.frame) / sr) * 1000;

      const tsBytes = new Float64Array([deviceTimestamp]);
      const pcmBytes = new Uint8Array(pcm.buffer);
      const packet = new Uint8Array(8 + pcmBytes.length);
      packet.set(new Uint8Array(tsBytes.buffer), 0);
      packet.set(pcmBytes, 8);
      sendMessage(packet.buffer);
    };

    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(gain);
    gain.connect(ctx.destination);

    audioContextRef.current = ctx;
    workletNodeRef.current = workletNode;
    streamRef.current = stream;
    setIsRecording(true);
  };

  const stopRecording = () => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    syncRef.current = null;
    setIsRecording(false);
  };

  return (
    <div className="flex flex-col items-center m-8">
      <h1 className="font-bold text-4xl text-white">Marine Recorder</h1>

      <Button
        className="mt-16 rounded-full w-[250px] h-[250px] text-white"
        onPress={isRecording ? stopRecording : startRecording}
        isIconOnly={true}
        variant="light"
        startContent={
          isRecording ? (
            <AiFillPauseCircle size={250} />
          ) : (
            <AiFillPlayCircle size={250} />
          )
        }
      ></Button>

      <Button
        className="mt-16 bg-rose-400 text-white! text-lg font-bold"
        variant="solid"
        size="lg"
        onPress={() => router.push("/")}
      >
        Return to Dashboard
      </Button>
    </div>
  );
}
