let model;
let video;
let canvas;
let ctx;
let isWebcamActive = false;
let stream = null;

async function loadModel() {
    model = await cocoSsd.load();
}

window.addEventListener('load', async () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    await loadModel();
});

document.getElementById('startWebcam').addEventListener('click', async () => {
    if (!isWebcamActive) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'environment'
                },
                audio: false
            });
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                isWebcamActive = true;
                detectFrame();
            };
        } catch (err) {
            console.log('Error accessing webcam:', err);
        }
    }
});

document.getElementById('stopWebcam').addEventListener('click', () => {
    if (isWebcamActive) {
        // Stop all video streams
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        isWebcamActive = false;
        
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
});

async function detectFrame() {
    if (!isWebcamActive) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const predictions = await model.detect(video);
    
    predictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        ctx.fillStyle = '#00ff00';
        ctx.font = '16px Arial';
        ctx.fillText(
            `${prediction.class} ${Math.round(prediction.score * 100)}%`,
            x, y > 20 ? y - 5 : y + 20
        );
    });
    
    requestAnimationFrame(detectFrame);
}