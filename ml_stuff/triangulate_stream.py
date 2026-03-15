import argparse
import json
import struct
import sys

import numpy as np
from scipy.optimize import minimize

SPEED_OF_SOUND = 1480  # m/s underwater


def get_time_delay(signal1, signal2, sample_rate):
    # Cross correlate the 2 signals
    correlation = np.correlate(signal1, signal2, mode="full")
    # Grab our max delay
    delay_samples = np.argmax(correlation) - (len(signal1) - 1)
    # Convert samples to seconds
    return delay_samples / sample_rate


# Use tdoa solver to get x,y,z cord
def tdoa_position(mic_positions, time_delays):
    # Low key just a whole bunch of bs that finds error of distance prediction
    # by comparing predicted time delays to measured delays
    def residuals(source_pos):
        errors = []
        ref = mic_positions[0]
        d_ref = np.linalg.norm(source_pos - ref)
        for i in range(1, len(mic_positions)):
            d_i = np.linalg.norm(source_pos - mic_positions[i])
            predicted_tdoa = (d_i - d_ref) / SPEED_OF_SOUND
            errors.append(predicted_tdoa - time_delays[i - 1])
        return np.sum(np.array(errors) ** 2)

    # Start prediction with mean position
    x0 = np.mean(mic_positions, axis=0)
    result = minimize(residuals, x0)
    return result.x  # Returns x,y,z but z is unreliable


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sr", type=int, default=48000, help="Input sample rate")
    # Mic positions passed as x y z for each mic
    parser.add_argument("--mic0", nargs=3, type=float, default=[0.0, 0.0, 0.0])
    parser.add_argument("--mic1", nargs=3, type=float, default=[1.0, 0.0, 0.0])
    parser.add_argument("--mic2", nargs=3, type=float, default=[0.5, 1.0, 0.0])
    args = parser.parse_args()

    sr = args.sr
    mic_positions = np.array([args.mic0, args.mic1, args.mic2])

    # 2-second rolling window per mic
    window_samples = sr * 2
    rings = [np.empty(0, dtype=np.float32) for _ in range(3)]

    while True:
        # Each packet: [1 byte mic_index][4 bytes LE uint32 length][length bytes PCM]
        header = sys.stdin.buffer.read(5)
        if not header or len(header) < 5:
            return

        mic_idx = header[0]
        data_len = struct.unpack_from("<I", header, 1)[0]

        raw = b""
        while len(raw) < data_len:
            chunk = sys.stdin.buffer.read(data_len - len(raw))
            if not chunk:
                return
            raw += chunk

        if mic_idx >= 3:
            continue

        n = len(raw) // 4
        samples = np.array(struct.unpack(f"<{n}f", raw[: n * 4]), dtype=np.float32)
        rings[mic_idx] = np.concatenate([rings[mic_idx], samples])[-window_samples:]

        # Only run triangulation when all 3 mics have a full window of data
        if any(len(r) < window_samples for r in rings):
            continue

        delay_2_1 = get_time_delay(rings[0], rings[1], sr)
        delay_3_1 = get_time_delay(rings[0], rings[2], sr)

        # Get position and distance
        source_xyz = tdoa_position(mic_positions, [delay_2_1, delay_3_1])

        print(
            json.dumps(
                {
                    "type": "triangulation",
                    "x": round(float(source_xyz[0]), 4),
                    "y": round(float(source_xyz[1]), 4),
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
