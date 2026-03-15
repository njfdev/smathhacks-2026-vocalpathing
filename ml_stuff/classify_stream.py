import argparse
import json
import struct
import sys

import librosa
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
import torch

CLASS_NAMES = [
    "humpback_song",
    "humpback_call",
    "orca_call",
    "orca_echolocation",
    "blue_whale",
    "fin_whale",
    "minke_whale",
    "brydes_whale_biotwang",
    "brydes_whale_call",
    "narw_upcall",
    "narw_gunshot",
    "nprw",
]

MODEL_SR = 10000
WINDOW_SEC = 5
MODEL_SAMPLES = MODEL_SR * WINDOW_SEC  # 50,000


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sr", type=int, default=48000, help="Input sample rate")
    parser.add_argument(
        "--client-id", type=str, default="unknown", help="Client ID tag"
    )
    args = parser.parse_args()

    input_sr = args.sr
    client_id = args.client_id
    bytes_per_window = input_sr * WINDOW_SEC * 4

    print(
        json.dumps({"type": "status", "from": client_id, "status": "loading_model"}),
        flush=True,
    )
    model = hub.load(
        "https://www.kaggle.com/models/google/multispecies-whale/TensorFlow2/default/2"
    )

    metadata = model.metadata()
    model_sr = int(metadata["input_sample_rate"].numpy())
    context_width = int(metadata["context_width_samples"].numpy())
    MODEL_SAMPLES_ACTUAL = context_width

    @tf.function
    def get_spectrogram(audio):
        return model.front_end(audio)

    @tf.function
    def get_outputs(spectrogram):
        return model(spectrogram)

    print(
        json.dumps(
            {
                "type": "status",
                "from": client_id,
                "status": "ready",
                "model_sr": model_sr,
                "context_width": context_width,
            }
        ),
        flush=True,
    )

    while True:
        raw = b""
        while len(raw) < bytes_per_window:
            chunk = sys.stdin.buffer.read(bytes_per_window - len(raw))
            if not chunk:
                return
            raw += chunk

        num_samples = len(raw) // 4
        audio_np = np.array(struct.unpack(f"<{num_samples}f", raw), dtype=np.float32)

        if input_sr != model_sr:
            audio_np = librosa.resample(audio_np, orig_sr=input_sr, target_sr=model_sr)

        if len(audio_np) < MODEL_SAMPLES_ACTUAL:
            audio_np = np.pad(audio_np, (0, MODEL_SAMPLES_ACTUAL - len(audio_np)))
        else:
            audio_np = audio_np[:MODEL_SAMPLES_ACTUAL]

        audio_tensor = tf.constant(
            audio_np[np.newaxis, :, np.newaxis], dtype=tf.float32
        )
        spectrogram = get_spectrogram(audio_tensor)
        outputs = get_outputs(spectrogram)

        scores_tensor = torch.sigmoid(torch.from_numpy(outputs.numpy()))
        scores_list = ((scores_tensor[0] - 0.5) * 2.0).tolist()

        scores_dict = {
            name: round(score, 4) for name, score in zip(CLASS_NAMES, scores_list)
        }

        top_idx = torch.argmax(scores_tensor, dim=1)[0].item()
        top_class = CLASS_NAMES[top_idx]

        if scores_list[top_idx] < 0.5:
            top_class = "None"
            top_score = 0.0
        else:
            top_score = round(scores_list[top_idx], 4)

        result = {
            "type": "classification",
            "from": client_id,
            "topClass": top_class,
            "topScore": top_score,
            "scores": scores_dict,
        }

        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
