let model;
let video;
let canvas;
let ctx;
let isWebcamActive = false;
let stream = null;
let currentFacingMode = 'environment';
let animationFrameId = null;
let retryCount = 0;
const MAX_RETRIES = 3;

const modelPromise = cocoSsd.load();

window.addEventListener('load', async () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d', { alpha: false });
    model = await modelPromise;
});

document.getElementById('flipCamera').addEventListener('click', async () => {
    if (isWebcamActive) {
        await switchCamera();
    }
});

async function checkCameraPermission() {
    try {
        const result = await navigator.permissions.query({ name: 'camera' });
        return result.state === 'granted';
    } catch (err) {
        return false;
    }
}

async function switchCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    await startVideoStream();
}

async function initializeCamera() {
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMultipleCameras = devices.filter(d => d.kind === 'videoinput').length > 1;
        document.getElementById('flipCamera').style.display = hasMultipleCameras ? 'block' : 'none';
        
        await startVideoStream();
        loading.classList.remove('active');
        return true;
    } catch (err) {
        loading.textContent = 'Camera initialization failed. Retrying...';
        return false;
    }
}

async function startVideoStream() {
    const constraints = {
        video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            facingMode: currentFacingMode,
            frameRate: { ideal: 30, min: 10 }
        },
        audio: false
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        handleStreamSuccess(stream);
    } catch (err) {
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            return startVideoStream();
        }
        throw new Error(`Camera access failed after ${MAX_RETRIES} attempts`);
    }
}

function handleStreamSuccess(stream) {
    video.srcObject = stream;
    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            video.play()
                .then(() => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    resolve();
                })
                .catch(err => {
                    console.error('Playback failed:', err);
                    document.getElementById('predictions').textContent = 
                        'Video playback failed. Please try again.';
                });
        };
    });
}

function handleStreamError(error) {
    console.error('Stream error:', error);
    isWebcamActive = false;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    video.srcObject = null;
    document.getElementById('predictions').textContent = 
        'Camera error occurred. Please reload the page.';
}

document.getElementById('startWebcam').addEventListener('click', async () => {
    if (!isWebcamActive) {
        retryCount = 0;
        try {
            await initializeCamera();
            isWebcamActive = true;
            detectFrame();
        } catch (err) {
            handleStreamError(err);
        }
    }
});

document.getElementById('stopWebcam').addEventListener('click', () => {
    if (isWebcamActive) {
        cancelAnimationFrame(animationFrameId);
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
        isWebcamActive = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('predictions').textContent = '';
    }
});

async function detectFrame() {
    if (!isWebcamActive) return;
    
    try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const predictions = await model.detect(video, 20, 0.75);
        drawPredictions(predictions);
        animationFrameId = requestAnimationFrame(detectFrame);
    } catch (error) {
        handleStreamError(error);
    }
}

function drawPredictions(predictions) {
    predictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        const label = `${prediction.class} ${Math.round(prediction.score * 100)}%`;
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 16px Arial';
        const textY = y > 20 ? y - 5 : y + 20;
        
        const metrics = ctx.measureText(label);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x, textY - 16, metrics.width + 4, 20);
        
        ctx.fillStyle = '#00ff00';
        ctx.fillText(label, x + 2, textY);
    });
}