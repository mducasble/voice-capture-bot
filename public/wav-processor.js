/**
 * AudioWorklet Processor for WAV recording.
 * Runs in a dedicated audio thread — no main-thread jank = no clicks/pops.
 *
 * Accumulates Float32 PCM samples and posts them to the main thread
 * in batches to avoid excessive message passing overhead.
 */
class WavProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferLength = 0;
    this._isRecording = true;
    // Flush every ~4096 samples (≈85ms at 48kHz) for a good balance
    this._flushThreshold = 4096;

    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this._flush();
        this.port.postMessage({ type: 'done' });
        this._isRecording = false;
      }
    };
  }

  _flush() {
    if (this._bufferLength === 0) return;

    const merged = new Float32Array(this._bufferLength);
    let offset = 0;
    for (const chunk of this._buffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.port.postMessage(
      { type: 'samples', samples: merged },
      [merged.buffer] // Transfer ownership for zero-copy
    );

    this._buffer = [];
    this._bufferLength = 0;
  }

  process(inputs) {
    if (!this._isRecording) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Hard clip and copy (input buffers are reused by the engine)
    const copy = new Float32Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = channelData[i];
      copy[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }

    this._buffer.push(copy);
    this._bufferLength += copy.length;

    if (this._bufferLength >= this._flushThreshold) {
      this._flush();
    }

    return true;
  }
}

registerProcessor('wav-processor', WavProcessor);
