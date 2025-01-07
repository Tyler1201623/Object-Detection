let model;
let video;
let canvas;
let ctx;
let isWebcamActive = false;
let stream = null;
let currentFacingMode = 'environment';
let animationFrameId = null;

// Preload model immediately
const modelPromise = cocoSsd.load();

window.addEventListener('load', async () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d', { alpha: false }); // Optimize canvas
    model = await modelPromise; // Use preloaded model
});

document.getElementById('flipCamera').addEventListener('click', async () => {
    if (isWebcamActive) {
        await switchCamera();
    }
});

async function switchCamera() {
    stream.getTracks().forEach(track => track.stop());
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    await startVideoStream();
}

async function startVideoStream() {
    try {
        // First check if mediaDevices is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support camera access');
        }

        // Get list of available devices first
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');

        // Configure camera settings
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: currentFacingMode
            },
            audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
    } catch (err) {
        console.log('Available devices:', await navigator.mediaDevices.enumerateDevices());
        console.log('Camera error details:', err);
        throw err;
    }
}
document.getElementById('startWebcam').addEventListener('click', async () => {
    if (!isWebcamActive) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    facingMode: currentFacingMode,
                    frameRate: { ideal: 60 }
                },
                audio: false
            });
            
            video.srcObject = stream;
            video.play();
            
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
            };
            
            isWebcamActive = true;
            detectFrame();
            
        } catch (err) {
            console.error('Camera access error:', err);
        }
    }
});
document.getElementById('stopWebcam').addEventListener('click', () => {
    if (isWebcamActive) {
        cancelAnimationFrame(animationFrameId);
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        isWebcamActive = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
});

async function detectFrame() {
    if (!isWebcamActive) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    try {
        const predictions = await model.detect(video, 20, 0.75); // Increased confidence threshold
        drawPredictions(predictions);
    } catch (error) {
        console.error('Detection error:', error);
    }
    
    animationFrameId = requestAnimationFrame(detectFrame);
}        const predictions = await model.detect(video);
        drawPredictions(predictions);
    } catch (error) {
        console.error('Detection error:', error);
    }
    
    animationFrameId = requestAnimationFrame(detectFrame);
}

function drawPredictions(predictions) {
    predictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        
        // Draw box
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        // Draw label
        const label = `${prediction.class} ${Math.round(prediction.score * 100)}%`;
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 16px Arial';
        const textY = y > 20 ? y - 5 : y + 20;
        
        // Add background to text for better visibility
        const metrics = ctx.measureText(label);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x, textY - 16, metrics.width + 4, 20);
        
        ctx.fillStyle = '#00ff00';
        ctx.fillText(label, x + 2, textY);
    });
}