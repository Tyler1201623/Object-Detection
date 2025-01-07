$modelsPath = ".\models"
New-Item -ItemType Directory -Force -Path $modelsPath

$modelFiles = @(
    @{
        name = "coco-ssd.js"
        url = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd"
    },
    @{
        name = "tfjs.js"
        url = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs"
    },
    @{
        name = "coco-labels-paper.txt"
        url = "https://raw.githubusercontent.com/amikelive/coco-labels/master/coco-labels-paper.txt"
    }
)

foreach ($file in $modelFiles) {
    $output = Join-Path $modelsPath $file.name
    Write-Host "Downloading $($file.name)..."
    
    try {
        Invoke-WebRequest -Uri $file.url -OutFile $output -Headers @{
            "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        Write-Host "Successfully downloaded $($file.name)" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to download $($file.name): $_" -ForegroundColor Red
    }
}

Write-Host "`nAll model files downloaded successfully to $modelsPath" -ForegroundColor Green
Write-Host "Ready for webcam object detection!"