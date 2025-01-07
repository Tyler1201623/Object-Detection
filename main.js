let model, video, canvas, ctx, stream = null;
let isWebcamActive = false;
let currentFacingMode = 'environment';
let animationFrameId = null;
let retryCount = 0;
const MAX_RETRIES = 3;

// Fast loading indicators
const loadingIndicator = document.getElementById('loading');
const showLoading = () => loadingIndicator.classList.add('active');
const hideLoading = () => loadingIndicator.classList.remove('active');

// Preload model
const modelPromise = cocoSsd.load();

// Initialize on load
window.addEventListener('load', async () => {
    [video, canvas] = ['video', 'canvas'].map(id => document.getElementById(id));
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    model = await modelPromise;
});

// Camera controls
document.getElementById('flipCamera').addEventListener('click', () => 
    isWebcamActive && switchCamera());

document.getElementById('startWebcam').addEventListener('click', async () => {
    if (!isWebcamActive) {
        retryCount = 0;
        try {
            await initializeCamera();
            isWebcamActive = true;
            requestAnimationFrame(detectFrame);
        } catch (err) {
            handleStreamError(err);
        }
    }
});

document.getElementById('stopWebcam').addEventListener('click', () => {
    if (isWebcamActive) {
        cancelAnimationFrame(animationFrameId);
        stream?.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        isWebcamActive = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('predictions').textContent = '';
    }
});

// Core camera functions
async function initializeCamera() {
    showLoading();
    try {
        await startVideoStream();
        hideLoading();
        return true;
    } catch (err) {
        console.error('Camera init failed:', err);
        return false;
    }
}

async function startVideoStream() {
    const constraints = {
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: currentFacingMode,
            frameRate: { ideal: 30 }
        },
        audio: false
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        await handleStreamSuccess(stream);
    } catch (err) {
        if (retryCount++ < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 500));
            return startVideoStream();
        }
        throw new Error(`Camera access failed after ${MAX_RETRIES} attempts`);
    }
}

async function switchCamera() {
    showLoading();
    isWebcamActive = true; // Force active state
    
    // Complete cleanup
    cancelAnimationFrame(animationFrameId);
    if (stream) {
        stream.getTracks().forEach(track => {
            track.stop();
            stream.removeTrack(track);
        });
    }
    video.srcObject = null;
    
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    
    try {
        await startVideoStream();
        // Wait for video to be fully ready
        await new Promise((resolve) => {
            video.onloadeddata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
        
        // Kickstart detection immediately
        detectFrame();
        
    } catch (err) {
        handleStreamError(err);
    } finally {
        hideLoading();
    }
}

async function detectFrame() {
    if (!video.videoWidth) return;
    
    try {
        ctx.drawImage(video, 0, 0);
        const predictions = await model.detect(video);
        drawPredictions(predictions);
        
        if (isWebcamActive) {
            animationFrameId = requestAnimationFrame(detectFrame);
        }
    } catch (error) {
        console.error('Detection error:', error);
        if (isWebcamActive) {
            animationFrameId = requestAnimationFrame(detectFrame);
        }
    }
}
async function handleStreamSuccess(stream) {
    video.srcObject = stream;
    return new Promise((resolve) => {
        video.onloadedmetadata = async () => {
            try {
                await video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            } catch (err) {
                console.error('Playback failed:', err);
                document.getElementById('predictions').textContent = 'Video playback failed. Please try again.';
            }
        };
    });
}function handleStreamError(error) {
    console.error('Stream error:', error);
    isWebcamActive = false;
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    document.getElementById('predictions').textContent = 'Camera error occurred. Please reload the page.';
}

// Detection loop
async function detectFrame() {
    if (!isWebcamActive || !video.videoWidth) return;
    
    try {
        if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        
        ctx.drawImage(video, 0, 0);
        const predictions = await model.detect(video, 20, 0.75);
        drawPredictions(predictions);
        animationFrameId = requestAnimationFrame(detectFrame);
    } catch (error) {
        handleStreamError(error);
    }
}

// Optimized rendering
function drawPredictions(predictions) {
    predictions.forEach(({bbox: [x, y, width, height], class: label, score}) => {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        const text = `${label} ${Math.round(score * 100)}%`;
        const textY = y > 20 ? y - 5 : y + 20;
        
        ctx.font = 'bold 16px Arial';
        const metrics = ctx.measureText(text);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x, textY - 16, metrics.width + 4, 20);
        
        ctx.fillStyle = '#00ff00';
        ctx.fillText(text, x + 2, textY);
    });
}
