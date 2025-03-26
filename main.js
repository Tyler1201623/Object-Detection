let model, video, canvas, ctx, stream = null;
let isWebcamActive = false;
let currentFacingMode = 'environment';
let animationFrameId = null;
let retryCount = 0;
let isDarkMode = true; // Default to dark mode
let lastFrameTime = 0;
let frameCount = 0;
let fpsUpdateTime = 0;
let currentFps = 0;
let detectedObjects = [];
let previousDetections = []; // Store previous frame detections to reduce flickering
let detectionHistory = {}; // Track objects across multiple frames
let isLoading = false;
let selectedModel = 'mobilenet_v2'; // Default to more accurate model
const MAX_RETRIES = 3;
const DETECTION_THRESHOLD = 0.75; // Balanced threshold for stability and accuracy
const MAX_DETECTION_BOXES = 100; // Increased for better multiple object detection
const DETECTION_MEMORY_FRAMES = 3; // How many frames to remember detections

// DOM Elements
const loadingIndicator = document.getElementById('loading');
const statsPanel = document.getElementById('stats-panel');
const fpsDisplay = document.getElementById('fps');
const objectCountDisplay = document.getElementById('object-count');
const predictionsElement = document.getElementById('predictions');
const snapshotsContainer = document.getElementById('snapshots-container');
const modelSelect = document.getElementById('model-select');

// Quick access functions
const showLoading = () => {
    loadingIndicator.classList.add('active');
    isLoading = true;
};
const hideLoading = () => {
    loadingIndicator.classList.remove('active');
    isLoading = false;
};
const showStats = () => statsPanel.classList.add('active');
const hideStats = () => statsPanel.classList.remove('active');

// Dark mode handling
const setDarkMode = (isDark) => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('darkModeToggle').innerHTML = 
        `<span class="material-symbols-rounded">${isDark ? 'light_mode' : 'dark_mode'}</span>`;
    isDarkMode = isDark;
    localStorage.setItem('darkMode', isDark);
};

// Load model based on user selection
const loadSelectedModel = () => {
    // If there's already a model loading or loaded, return that promise
    if (model) {
        return Promise.resolve(model);
    }
    
    return cocoSsd.load({
        base: selectedModel, // Use the selected model
    }).catch(err => {
        console.warn(`Failed to load ${selectedModel} model, trying fallback:`, err);
        return cocoSsd.load(); // Default fallback
    });
};

// Preload the default model in the background
let modelPromise = loadSelectedModel();

// Initialize on load
window.addEventListener('load', async () => {
    // Check for HTTPS - camera may require secure context
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1')) {
        console.warn('Camera access may require HTTPS for security reasons');
    }

    // Set dark mode based on saved preference or system preference
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode !== null) {
        setDarkMode(savedDarkMode === 'true');
    } else {
        // Check for system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setDarkMode(prefersDark);
    }

    // Get DOM elements
    [video, canvas] = ['video', 'canvas'].map(id => document.getElementById(id));
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    
    // Try to load model in advance
    try {
        model = await modelPromise;
        console.log('Model preloaded successfully');
    } catch (err) {
        console.warn('Model preload failed, will try again when needed:', err);
    }

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('darkMode') === null) {
            setDarkMode(e.matches);
        }
    });
    
    // Set initial visibility and size
    if (canvas) {
        canvas.style.backgroundColor = 'transparent';
    }
    if (video) {
        video.style.backgroundColor = 'var(--neutral-dark)';
    }
    
    // Set up model selection
    if (modelSelect) {
        // Initialize with stored value if available
        const savedModel = localStorage.getItem('selectedModel');
        if (savedModel) {
            selectedModel = savedModel;
            modelSelect.value = selectedModel;
        }
        
        // Listen for changes
        modelSelect.addEventListener('change', async () => {
            const newModel = modelSelect.value;
            
            // Only reload if the model actually changed
            if (newModel !== selectedModel) {
                selectedModel = newModel;
                localStorage.setItem('selectedModel', selectedModel);
                
                // Show loading if camera is active
                if (isWebcamActive) {
                    showLoading();
                }
                
                // Clear current model and reload
                model = null;
                modelPromise = loadSelectedModel();
                
                try {
                    model = await modelPromise;
                    console.log(`Switched to ${selectedModel} model`);
                    
                    // Clear current detections to apply new model
                    detectedObjects = [];
                    previousDetections = [];
                    detectionHistory = {};
                } catch (err) {
                    console.error('Failed to load new model:', err);
                } finally {
                    if (isWebcamActive) {
                        hideLoading();
                    }
                }
            }
        });
    }
});

// Camera controls
document.getElementById('darkModeToggle').addEventListener('click', () => {
    setDarkMode(!isDarkMode);
});

document.getElementById('flipCamera').addEventListener('click', () => 
    isWebcamActive && switchCamera());

document.getElementById('startWebcam').addEventListener('click', async () => {
    if (!isWebcamActive && !isLoading) {
        retryCount = 0;
        try {
            await initializeCamera();
            isWebcamActive = true;
            showStats();
            requestAnimationFrame(detectFrame);
        } catch (err) {
            handleStreamError(err);
        }
    }
});

document.getElementById('stopWebcam').addEventListener('click', () => {
    if (isWebcamActive) {
        stopCamera();
    }
});

document.getElementById('takeSnapshot').addEventListener('click', () => {
    if (isWebcamActive) {
        takeSnapshot();
    }
});

function stopCamera() {
    cancelAnimationFrame(animationFrameId);
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    isWebcamActive = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hideStats();
    detectedObjects = [];
    previousDetections = [];
    detectionHistory = {};
    updateObjectCount();
    document.querySelector('.display-section').classList.remove('active-detection');
    
    // Clear predictions panel
    if (predictionsElement) {
        predictionsElement.innerHTML = '';
    }
}

async function initializeCamera() {
    showLoading();
    
    // Ensure model is loaded
    if (!model) {
        try {
            model = await modelPromise;
        } catch (err) {
            console.error('Failed to load model:', err);
            hideLoading();
            throw new Error('Could not load detection model');
        }
    }
    
    try {
        stream = await startVideoStream();
        hideLoading();
        return true;
    } catch (err) {
        console.error('Camera init failed:', err);
        hideLoading();
        return false;
    }
}

async function startVideoStream() {
    const constraints = {
        video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: currentFacingMode,
            frameRate: { ideal: 30 }
        },
        audio: false
    };

    // Try simpler constraints if the initial request fails
    const fallbackConstraints = {
        video: true,
        audio: false
    };

    return navigator.mediaDevices.getUserMedia(constraints)
        .catch(error => {
            console.warn('Using fallback constraints due to:', error);
            return navigator.mediaDevices.getUserMedia(fallbackConstraints);
        })
        .then(async stream => {
            await handleStreamSuccess(stream);
            return stream;
        })
        .catch(error => {
            if (retryCount++ < MAX_RETRIES) {
                return new Promise(resolve => setTimeout(resolve, 500))
                    .then(startVideoStream);
            }
            throw new Error(`Camera access failed after ${MAX_RETRIES} attempts: ${error.message}`);
        });
}

async function switchCamera() {
    if (isLoading) return;
    
    showLoading();
    isWebcamActive = false;
    
    cancelAnimationFrame(animationFrameId);
    
    if (stream) {
        stream.getTracks().forEach(track => {
            track.stop();
        });
    }
    video.srcObject = null;
    
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: { exact: currentFacingMode },
                frameRate: { ideal: 30 }
            },
            audio: false
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        await new Promise((resolve) => {
            video.onloadeddata = async () => {
                await video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
        
        isWebcamActive = true;
        detectedObjects = [];
        previousDetections = [];
        detectionHistory = {};
        detectFrame();
        
    } catch (err) {
        console.error('Camera switch failed:', err);
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        await startVideoStream();
        isWebcamActive = true;
        detectFrame();
    } finally {
        hideLoading();
    }
}

async function handleStreamSuccess(stream) {
    video.srcObject = stream;
    return new Promise((resolve) => {
        video.onloadedmetadata = async () => {
            try {
                // Ensure video plays correctly
                await video.play().catch(err => {
                    console.warn('Video play warning:', err);
                });
                
                // Make sure dimensions are set correctly
                setTimeout(() => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    // Show video element explicitly
                    video.style.display = "block";
                    console.log("Video dimensions:", video.videoWidth, "x", video.videoHeight);
                }, 100);
                
                resolve();
            } catch (err) {
                console.error('Playback failed:', err);
                predictionsElement.textContent = 'Video playback failed. Please try again.';
            }
        };
    });
}

function handleStreamError(error) {
    console.error('Stream error:', error);
    isWebcamActive = false;
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    hideLoading();
    
    // Show user friendly error message
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.innerHTML = `
        <span class="material-symbols-rounded">error</span>
        <p>${error.name === 'NotAllowedError' ? 
            'Camera access denied. Please allow camera access and try again.' : 
            'Camera error occurred. Please check your camera and reload the page.'}</p>
    `;
    
    predictionsElement.innerHTML = '';
    predictionsElement.appendChild(errorMessage);
}

// Generate a unique ID for tracking objects
function generateObjectId(prediction) {
    const { bbox, class: label } = prediction;
    const [x, y, width, height] = bbox;
    // Create a key based on position and class
    return `${label}_${Math.round(x/10)}_${Math.round(y/10)}_${Math.round(width/10)}_${Math.round(height/10)}`;
}

// Calculate IoU (Intersection over Union) for two bounding boxes
function calculateIoU(box1, box2) {
    const [x1, y1, width1, height1] = box1;
    const [x2, y2, width2, height2] = box2;
    
    const xOverlap = Math.max(0, Math.min(x1 + width1, x2 + width2) - Math.max(x1, x2));
    const yOverlap = Math.max(0, Math.min(y1 + height1, y2 + height2) - Math.max(y1, y2));
    const overlapArea = xOverlap * yOverlap;
    
    const box1Area = width1 * height1;
    const box2Area = width2 * height2;
    
    return overlapArea / (box1Area + box2Area - overlapArea);
}

// Check if an object persists from previous frames by comparing with history
function matchWithHistory(prediction) {
    const currentTime = performance.now();
    
    for (const [id, histObj] of Object.entries(detectionHistory)) {
        // Skip if class doesn't match
        if (histObj.class !== prediction.class) continue;
        
        // Check if boxes are similar
        const iou = calculateIoU(histObj.bbox, prediction.bbox);
        if (iou > 0.3) {
            // Update the history with this new detection
            detectionHistory[id] = {
                ...prediction,
                lastSeen: currentTime,
                frameCount: histObj.frameCount + 1,
                score: 0.6 * prediction.score + 0.4 * histObj.score // Smooth scores for stability
            };
            // Return the updated history object, which contains smoothed values
            return {
                ...prediction,
                score: detectionHistory[id].score,
                id,
                persistent: true
            };
        }
    }
    
    // If no match found, create new history entry
    const id = generateObjectId(prediction);
    detectionHistory[id] = {
        ...prediction,
        lastSeen: currentTime,
        frameCount: 1
    };
    
    return {
        ...prediction,
        id,
        persistent: false
    };
}

// Clean up old detections that haven't been seen recently
function cleanupDetectionHistory() {
    const currentTime = performance.now();
    const expiryTime = 500; // 500ms expiry time
    
    Object.keys(detectionHistory).forEach(id => {
        if (currentTime - detectionHistory[id].lastSeen > expiryTime) {
            delete detectionHistory[id];
        }
    });
}

async function detectFrame() {
    if (!video.videoWidth || !isWebcamActive) return;
    
    const now = performance.now();
    
    try {
        // Match canvas to video dimensions
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        
        // Draw video frame to canvas - ensure proper drawing
        try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            console.error('Error drawing video to canvas:', e);
        }
        
        // Add active detection indicator to display section
        document.querySelector('.display-section').classList.add('active-detection');
        
        // Run detection on intervals to maintain smooth performance
        if (now - lastFrameTime > 60) { // Process at ~16fps for balance of performance and accuracy
            lastFrameTime = now;
            
            // Save previous detections
            previousDetections = [...detectedObjects];
            
            // Run detection with more boxes and balanced threshold
            const predictions = await model.detect(video, MAX_DETECTION_BOXES, DETECTION_THRESHOLD);
            
            // Process new detections with history tracking for stability
            detectedObjects = predictions
                .filter(pred => pred.score >= DETECTION_THRESHOLD)
                // Match against history to smooth detections
                .map(pred => matchWithHistory(pred))
                // Sort by confidence score
                .sort((a, b) => b.score - a.score)
                // Filter similar boxes (improved NMS for multiple detections)
                .filter((pred, index, array) => {
                    // Always keep high confidence detections
                    if (pred.score > 0.85) return true;
                    
                    // For lower confidence, check if it significantly overlaps with a higher confidence box
                    // Loop through higher confidence boxes
                    for (let i = 0; i < index; i++) {
                        // Only compare if same class
                        if (pred.class === array[i].class) {
                            const iou = calculateIoU(pred.bbox, array[i].bbox);
                            // If significant overlap with the same class, discard this box
                            if (iou > 0.4) return false;
                        }
                    }
                    return true;
                });
            
            // Add persistent detections that may not be detected in current frame
            if (previousDetections.length > 0) {
                previousDetections.forEach(prevObj => {
                    const isStillDetected = detectedObjects.some(
                        obj => obj.id === prevObj.id
                    );
                    
                    // If an object disappeared but was stable (seen in multiple frames), keep it for a few more frames
                    if (!isStillDetected && prevObj.persistent) {
                        const histObj = detectionHistory[prevObj.id];
                        // Only add if it was recently seen and has been tracked for at least 2 frames
                        if (histObj && 
                            histObj.frameCount >= 2 && 
                            now - histObj.lastSeen < 300) {
                            // Add it back with slightly reduced confidence
                            detectedObjects.push({
                                ...prevObj,
                                score: prevObj.score * 0.9
                            });
                        }
                    }
                });
            }
            
            // Clean up detection history
            cleanupDetectionHistory();
            
            // Update object count display
            updateObjectCount();
            
            // Update predictions panel
            updatePredictionsPanel(detectedObjects);
        }

        // Always draw the detections to maintain visual continuity
        drawPredictions(detectedObjects);
        
        // Calculate FPS
        frameCount++;
        if (now - fpsUpdateTime > 1000) { // Update FPS display every second
            currentFps = Math.round((frameCount * 1000) / (now - fpsUpdateTime));
            fpsDisplay.textContent = currentFps;
            frameCount = 0;
            fpsUpdateTime = now;
        }
        
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

function updateObjectCount() {
    if (objectCountDisplay) {
        objectCountDisplay.textContent = detectedObjects.length;
    }
}

function drawPredictions(predictions) {
    // Clear previous drawings but preserve video frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // If video is not visible, try to draw it to the canvas again
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
        try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            console.error('Error redrawing video to canvas:', e);
        }
    }
    
    // Render each prediction with enhanced accuracy display
    predictions.forEach(({bbox: [x, y, width, height], class: label, score, persistent}) => {
        const confidence = Math.round(score * 100);
        
        // Enhanced color selection based on confidence and persistence
        let color;
        if (persistent) {
            color = '#00C853'; // Bright green for stable detections
        } else if (confidence > 85) {
            color = '#2CB67D'; // Green for high confidence
        } else if (confidence > 75) {
            color = '#7F5AF0'; // Purple for medium confidence
        } else {
            color = '#E53170'; // Pink for lower confidence
        }
        
        // Draw bounding box with enhanced glow effect
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        
        // Enhanced box shadow effect
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.strokeRect(x, y, width, height);
        ctx.shadowBlur = 0;
        
        // Prepare enhanced label text
        const text = `${label} ${confidence}%`;
        const padding = 10;
        ctx.font = 'bold 16px Inter, sans-serif';
        const textWidth = ctx.measureText(text).width;
        
        // Draw label background
        const textY = y > 30 ? y - 12 : y + height + 24;
        const textX = x;
        
        // Semi-transparent background with rounded corners
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; // Increased opacity for better visibility
        ctx.beginPath();
        ctx.roundRect(textX - padding/2, textY - 20, textWidth + padding, 28, 5);
        ctx.fill();
        
        // Draw colored indicator line
        ctx.fillStyle = color;
        ctx.fillRect(textX - padding/2, textY - 20, 4, 28);
        
        // Draw label text
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, textX + padding/2, textY - 2);
    });
}

function updatePredictionsPanel(predictions) {
    if (!predictionsElement) return;
    
    if (predictions.length === 0) {
        predictionsElement.innerHTML = '<div class="no-objects">No objects detected</div>';
        return;
    }
    
    // Get the counts of each type of object
    const objectCounts = {};
    predictions.forEach(({class: label}) => {
        objectCounts[label] = (objectCounts[label] || 0) + 1;
    });
    
    // Convert to array and sort by count
    const sortedObjects = Object.entries(objectCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({label, count}));
    
    // Create the HTML
    const html = `
        <div class="predictions-header">
            <h3>Detected Objects</h3>
            <span class="total-count">${predictions.length} ${predictions.length === 1 ? 'object' : 'objects'}</span>
        </div>
        <div class="predictions-grid">
            ${sortedObjects.map(({label, count}) => `
                <div class="prediction-item">
                    <div class="prediction-icon">
                        <span class="material-symbols-rounded">${getIconForObject(label)}</span>
                    </div>
                    <div class="prediction-details">
                        <div class="prediction-label">${label}</div>
                        <div class="prediction-count">${count} ${count === 1 ? 'instance' : 'instances'}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    predictionsElement.innerHTML = html;
}

function getIconForObject(label) {
    // Map common objects to Material Design icons
    const iconMap = {
        person: 'person',
        bicycle: 'pedal_bike',
        car: 'directions_car',
        motorcycle: 'two_wheeler',
        airplane: 'flight',
        bus: 'directions_bus',
        train: 'train',
        truck: 'local_shipping',
        boat: 'directions_boat',
        'traffic light': 'traffic',
        'fire hydrant': 'local_fire_department',
        'stop sign': 'do_not_disturb_on',
        'parking meter': 'local_parking',
        bench: 'weekend',
        bird: 'flutter_dash',
        cat: 'pets',
        dog: 'pets',
        horse: 'pets',
        sheep: 'pets',
        cow: 'pets',
        elephant: 'pets',
        bear: 'pets',
        zebra: 'pets',
        giraffe: 'pets',
        backpack: 'backpack',
        umbrella: 'umbrella',
        handbag: 'shopping_bag',
        tie: 'styler',
        suitcase: 'luggage',
        frisbee: 'sports_baseball',
        skis: 'downhill_skiing',
        snowboard: 'snowboarding',
        'sports ball': 'sports_soccer',
        kite: 'wind_power',
        'baseball bat': 'sports_baseball',
        'baseball glove': 'sports_baseball',
        skateboard: 'skateboarding',
        surfboard: 'surfing',
        'tennis racket': 'sports_tennis',
        bottle: 'liquor',
        'wine glass': 'wine_bar',
        cup: 'coffee',
        fork: 'restaurant',
        knife: 'restaurant',
        spoon: 'restaurant',
        bowl: 'restaurant',
        banana: 'nutrition',
        apple: 'nutrition',
        sandwich: 'lunch_dining',
        orange: 'nutrition',
        broccoli: 'nutrition',
        carrot: 'nutrition',
        'hot dog': 'lunch_dining',
        pizza: 'local_pizza',
        donut: 'bakery_dining',
        cake: 'cake',
        chair: 'chair',
        couch: 'weekend',
        'potted plant': 'potted_plant',
        bed: 'bed',
        'dining table': 'table_restaurant',
        toilet: 'wc',
        tv: 'tv',
        laptop: 'laptop',
        mouse: 'mouse',
        remote: 'remote_gen',
        keyboard: 'keyboard',
        'cell phone': 'smartphone',
        microwave: 'microwave',
        oven: 'oven',
        toaster: 'toaster',
        sink: 'sink',
        refrigerator: 'kitchen',
        book: 'auto_stories',
        clock: 'schedule',
        vase: 'format_paint',
        scissors: 'content_cut',
        'teddy bear': 'toys',
        'hair drier': 'hair_dryer',
        toothbrush: 'brush_teeth',
    };
    
    return iconMap[label.toLowerCase()] || 'search';
}

function takeSnapshot() {
    if (!isWebcamActive) return;
    
    // Create a snapshot canvas with the current frame and detections
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = canvas.width;
    snapshotCanvas.height = canvas.height;
    const snapshotCtx = snapshotCanvas.getContext('2d');
    
    // Draw video frame
    snapshotCtx.drawImage(video, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
    
    // Draw current detections
    detectedObjects.forEach(({bbox: [x, y, width, height], class: label, score}) => {
        const confidence = Math.round(score * 100);
        
        // Select color based on confidence
        let color;
        if (confidence > 85) color = '#2CB67D';
        else if (confidence > 70) color = '#7F5AF0';
        else color = '#E53170';
        
        // Draw bounding box
        snapshotCtx.strokeStyle = color;
        snapshotCtx.lineWidth = 3;
        snapshotCtx.strokeRect(x, y, width, height);
        
        // Draw label
        const text = `${label} ${confidence}%`;
        const padding = 8;
        snapshotCtx.font = 'bold 16px Inter, sans-serif';
        const textWidth = snapshotCtx.measureText(text).width;
        
        const textY = y > 30 ? y - 12 : y + height + 24;
        const textX = x;
        
        snapshotCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        snapshotCtx.beginPath();
        snapshotCtx.roundRect(textX - padding/2, textY - 20, textWidth + padding, 28, 5);
        snapshotCtx.fill();
        
        snapshotCtx.fillStyle = color;
        snapshotCtx.fillRect(textX - padding/2, textY - 20, 4, 28);
        
        snapshotCtx.fillStyle = '#FFFFFF';
        snapshotCtx.fillText(text, textX + padding/2, textY - 2);
    });
    
    // Create snapshot container
    const snapshotContainer = document.createElement('div');
    snapshotContainer.className = 'snapshot-item';
    
    // Add timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'snapshot-timestamp';
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString();
    
    // Add download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'snapshot-download';
    downloadBtn.innerHTML = '<span class="material-symbols-rounded">download</span>';
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.download = `object-detection-${now.toISOString().replace(/:/g, '-')}.png`;
        link.href = snapshotCanvas.toDataURL('image/png');
        link.click();
    });
    
    // Add delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'snapshot-delete';
    deleteBtn.innerHTML = '<span class="material-symbols-rounded">delete</span>';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        snapshotContainer.remove();
        
        // If no snapshots left, hide the container
        if (snapshotsContainer.children.length === 0) {
            snapshotsContainer.style.display = 'none';
        }
    });
    
    // Create controls container
    const controls = document.createElement('div');
    controls.className = 'snapshot-controls';
    controls.appendChild(timestamp);
    controls.appendChild(downloadBtn);
    controls.appendChild(deleteBtn);
    
    // Add the canvas to the container
    snapshotContainer.appendChild(snapshotCanvas);
    snapshotContainer.appendChild(controls);
    
    // Add to snapshots container
    snapshotsContainer.style.display = 'flex';
    snapshotsContainer.insertBefore(snapshotContainer, snapshotsContainer.firstChild);
    
    // Show confirmation feedback
    const feedback = document.createElement('div');
    feedback.className = 'snapshot-feedback';
    feedback.textContent = 'Snapshot saved!';
    document.body.appendChild(feedback);
    
    // Remove feedback after animation
    setTimeout(() => {
        feedback.remove();
    }, 3000);
}

// Add roundRect to older browsers if not supported
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radius) {
        if (width < 2 * radius) radius = width / 2;
        if (height < 2 * radius) radius = height / 2;
        this.beginPath();
        this.moveTo(x + radius, y);
        this.arcTo(x + width, y, x + width, y + height, radius);
        this.arcTo(x + width, y + height, x, y + height, radius);
        this.arcTo(x, y + height, x, y, radius);
        this.arcTo(x, y, x + width, y, radius);
        this.closePath();
        return this;
    };
}