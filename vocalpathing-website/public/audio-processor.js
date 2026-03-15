class TimestampProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(4096);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let srcOffset = 0;
    while (srcOffset < input.length) {
      const remaining = this._buffer.length - this._offset;
      const toCopy = Math.min(remaining, input.length - srcOffset);
      this._buffer.set(input.subarray(srcOffset, srcOffset + toCopy), this._offset);
      this._offset += toCopy;
      srcOffset += toCopy;

      if (this._offset >= this._buffer.length) {
        // currentFrame is the hardware sample counter for the START of this 128-sample render quantum
        // We calculate the frame corresponding to when this full chunk started filling
        const chunkStartFrame = currentFrame - this._buffer.length;
        this.port.postMessage({
          pcm: this._buffer.slice(),
          frame: chunkStartFrame,
          sampleRate: sampleRate,
        });
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("timestamp-processor", TimestampProcessor);
