// timestamp-worker.js - Decodes timestamps from C++ video frames

// Custom data append params (matching C++ encoder)
const CustomDataDetector = 'AgoraWrc';
const CustomDatLengthByteCount = 4;
const textDecoder = new TextDecoder();
let lastTimestamp = "";
let frameCount = 0;
let endianness = null; // Will be detected

async function decodeFunction(encodedFrame, controller) {
    frameCount++;
    
    if (encodedFrame instanceof RTCEncodedVideoFrame) {
        // Log every 30th frame to avoid spam
        if (frameCount % 30 === 0) {
            console.log("[Worker] Processing video frame", frameCount, "size:", encodedFrame.data.byteLength);
        }
        
        const view = new DataView(encodedFrame.data);
        
        if (encodedFrame.data.byteLength >= CustomDataDetector.length + CustomDatLengthByteCount) {
            // Extract magic string from end of frame
            const magicData = new Uint8Array(
                encodedFrame.data, 
                encodedFrame.data.byteLength - CustomDataDetector.length, 
                CustomDataDetector.length
            );
            
            let magicString = String.fromCharCode(...magicData);
            
            if (magicString === CustomDataDetector) {
                console.log("[Worker] Found magic string!");
                
                // Extract timestamp length - try both endianness if not yet determined
                const lengthOffset = encodedFrame.data.byteLength - (CustomDatLengthByteCount + CustomDataDetector.length);
                
                let timestampLen;
                if (endianness === null) {
                    // Try little-endian first (C++ default)
                    const timestampLenLE = view.getUint32(lengthOffset, true);
                    const timestampLenBE = view.getUint32(lengthOffset, false);
                    
                    console.log("[Worker] Trying to detect endianness - LE:", timestampLenLE, "BE:", timestampLenBE);
                    
                    // Sanity check - timestamp length should be reasonable (< 100 bytes)
                    if (timestampLenLE > 0 && timestampLenLE < 100) {
                        endianness = 'little';
                        timestampLen = timestampLenLE;
                        console.log("[Worker] Detected little-endian format");
                    } else if (timestampLenBE > 0 && timestampLenBE < 100) {
                        endianness = 'big';
                        timestampLen = timestampLenBE;
                        console.log("[Worker] Detected big-endian format");
                    } else {
                        console.log("[Worker] Could not determine endianness, lengths unreasonable");
                        controller.enqueue(encodedFrame);
                        return;
                    }
                } else {
                    // Use detected endianness
                    timestampLen = view.getUint32(lengthOffset, endianness === 'little');
                }
                
                console.log("[Worker] Timestamp length:", timestampLen, "using", endianness, "endian");
                
                // Calculate original frame size
                const frameSize = encodedFrame.data.byteLength - (timestampLen + CustomDatLengthByteCount + CustomDataDetector.length);
                
                if (frameSize > 0 && timestampLen > 0 && timestampLen < 100) {
                    // Extract timestamp
                    const timestampBuffer = new Uint8Array(encodedFrame.data, frameSize, timestampLen);
                    const timestamp = textDecoder.decode(timestampBuffer);
                    
                    console.log("[Worker] Extracted timestamp:", timestamp);
                    
                    // Send timestamp to main thread if it changed
                    if (timestamp !== lastTimestamp) {
                        lastTimestamp = timestamp;
                        self.postMessage(timestamp);
                    }
                    
                    // Create new buffer with just the video data (remove custom data)
                    const newData = new ArrayBuffer(frameSize);
                    const newDataArray = new Uint8Array(newData);
                    newDataArray.set(new Uint8Array(encodedFrame.data, 0, frameSize));
                    encodedFrame.data = newData;
                } else {
                    console.log("[Worker] Invalid lengths - frameSize:", frameSize, "timestampLen:", timestampLen);
                }
            } else {
                // Log what we found instead (every 30th frame)
                if (frameCount % 30 === 0) {
                    // Check if the magic string might be at a different position
                    const last20 = new Uint8Array(
                        encodedFrame.data, 
                        Math.max(0, encodedFrame.data.byteLength - 20), 
                        Math.min(20, encodedFrame.data.byteLength)
                    );
                    console.log("[Worker] No magic string found. Last 20 bytes:", 
                        Array.from(last20).map(b => b.toString(16).padStart(2, '0')).join(' '),
                        "ASCII:", Array.from(last20).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join(''));
                }
            }
        } else if (frameCount % 30 === 0) {
            console.log("[Worker] Frame too small:", encodedFrame.data.byteLength, "bytes");
        }
    }
    
    controller.enqueue(encodedFrame);
}

function handleTransform(operation, readable, writable) {
    console.log("[Worker] handleTransform called with operation:", operation);
    
    if (operation === 'decode') {
        const transformStream = new TransformStream({
            transform: decodeFunction,
        });
        readable
            .pipeThrough(transformStream)
            .pipeTo(writable);
    }
}

// Handler for messages, including transferable streams (Chrome legacy)
onmessage = (event) => {
    console.log("[Worker] onmessage received:", event.data.operation);
    if (event.data.operation === 'decode') {
        return handleTransform(event.data.operation, event.data.readable, event.data.writable);
    }
};

// Handler for RTCRtpScriptTransforms (Safari/Firefox/Chrome modern)
if (self.RTCTransformEvent) {
    self.onrtctransform = (event) => {
        console.log("[Worker] onrtctransform fired");
        const transformer = event.transformer;
        handleTransform(transformer.options.operation, transformer.readable, transformer.writable);
    };
}

console.log("[Worker] Decode worker loaded and ready");
