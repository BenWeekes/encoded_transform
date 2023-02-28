onrtctransform = (event) => {
  const transformer = event.transformer;

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

  function outgoing(transformer) {
    transformer.reader.read().then(chunk => {
      if (chunk.done)
        return;
  
      if (chunk.value instanceof RTCEncodedVideoFrame) {
        const watermark = textEncoder.encode(watermarkText);
        const frame = chunk.value.data;
        const data = new Uint8Array(chunk.value.data.byteLength + watermark.byteLength + 1 + 8);
        data.set(new Uint8Array(frame), 0);
        data.set (watermark, frame.byteLength);
        data[frame.byteLength + watermark.byteLength] = watermark.byteLength;

         // Set magic number at the end
        const magicIndex = chunk.value.data.byteLength + watermark.byteLength + 1;
        const magicString = 'AgoraWrc';
        for (let i = 0; i < 8; i++) {
          data[magicIndex + i] = magicString.charCodeAt(i);
        }

        chunk.value.data = data.buffer;
      }

      transformer.writer.write(chunk.value);      
      outgoing(transformer);
    });
  }

  function incoming(transformer) {
    transformer.reader.read().then(chunk => {
      if (chunk.done)
        return;
      
      if (chunk.value instanceof RTCEncodedVideoFrame) {
        const view = new DataView(chunk.value.data);

        // Get magic data
        const magicData = new Uint8Array(chunk.value.data, chunk.value.data.byteLength - 8, 8);
        let magic = [];
        for (let i = 0; i < 8; i ++) {
          magic.push(magicData[i]);
        }
        let magicString = String.fromCharCode(...magic);

        if (magicString === 'AgoraWrc') {
          // Get frame and watermark size
          const watermarkLen = view.getUint8(chunk.value.data.byteLength - (1 + 8));
          const frameSize = chunk.value.data.byteLength - (watermarkLen + 1 + 8);
  
          // Get watermark
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

  if(transformer.options.name === 'outgoing') {
    outgoing(transformer);
  } else if(transformer.options.name === 'incoming') {
    incoming(transformer);
  }
  
};
self.postMessage("registered");
