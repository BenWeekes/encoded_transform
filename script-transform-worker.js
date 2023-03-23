onrtctransform = (event) => {
  const transformer = event.transformer;

  // custom data append params
  var CustomDataDetector = 'AgoraWrc';
  var CustomDatLengthByteCount = 4;
  let watermarkText = "";
  let lastWatermark = "";

  transformer.options.port.onmessage = (event) => {
    watermarkText = event.data.watermark;
  }

  self.postMessage("started");
  transformer.reader = transformer.readable.getReader();
  transformer.writer = transformer.writable.getWriter();

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function getIntBytes(x) {
    var bytes = [];
    var i = CustomDatLengthByteCount;
    do {
      bytes[--i] = x & (255);
      x = x >> 8;
    } while (i)
    return bytes;
  }

  function outgoing(transformer) {
    transformer.reader.read().then(chunk => {
      if (chunk.done)
        return;

      if (chunk.value instanceof RTCEncodedVideoFrame) {
        const watermark = textEncoder.encode(watermarkText);
        const frame = chunk.value.data;
        const data = new Uint8Array(chunk.value.data.byteLength + watermark.byteLength + 1 + CustomDataDetector.length);
        data.set(new Uint8Array(frame), 0);
        data.set(watermark, frame.byteLength);
        var bytes = getIntBytes(watermark.byteLength);
        for (let i = 0; i < CustomDatLengthByteCount; i++) {
          data[frame.byteLength + watermark.byteLength + i] = bytes[i];
        }

        // Set magic string at the end
        const magicIndex = frame.byteLength + watermark.byteLength + CustomDatLengthByteCount;
        for (let i = 0; i < CustomDataDetector.length; i++) {
          data[magicIndex + i] = CustomDataDetector.charCodeAt(i);
        }
        chunk.value.data = data.buffer;
      }

      transformer.writer.write(chunk.value);
      outgoing(transformer);
    });
  }

  function incoming(transformer) {
    transformer.reader.read().then(chunk => {
      if (chunk.value.done)
        return;

      if (chunk.value instanceof RTCEncodedVideoFrame) {
        const view = new DataView(chunk.value.data);

        // Get magic data
        const magicData = new Uint8Array(chunk.value.data, chunk.value.data.byteLength - CustomDataDetector.length, CustomDataDetector.length);
        let magic = [];
        for (let i = 0; i < CustomDataDetector.length; i++) {
          magic.push(magicData[i]);
        }

        let magicString = String.fromCharCode(...magic);
        if (magicString === CustomDataDetector) {
          const watermarkLen = view.getUint32(chunk.value.data.byteLength - (CustomDatLengthByteCount + CustomDataDetector.length), false);
          const frameSize = chunk.value.data.byteLength - (watermarkLen + CustomDatLengthByteCount + CustomDataDetector.length);
          const watermarkBuffer = new Uint8Array(chunk.value.data, frameSize, watermarkLen);
          const watermark = textDecoder.decode(watermarkBuffer)

          if (lastWatermark !== watermark) {
            lastWatermark = watermark;
            transformer.options.port.postMessage(watermark);
          }

          // Get frame data
          const frame = new Uint8Array(frameSize);
          frame.set(new Uint8Array(chunk.value.data).subarray(0, frameSize));
          chunk.value.data = frame.buffer;
        }
      }
      transformer.writer.write(chunk.value);
      incoming(transformer);
    });
  }

  if (transformer.options.name === 'outgoing') {
    outgoing(transformer);
  } else if (transformer.options.name === 'incoming') {
    incoming(transformer);
  }

};
self.postMessage("registered");
