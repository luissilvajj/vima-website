document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const fileInput = document.getElementById('dxf-file');
    const dropZone = document.getElementById('drop-zone');
    const previewContainer = document.getElementById('preview-container');
    const fileNameDisplay = document.getElementById('file-name-display');
    const removeFileBtn = document.getElementById('remove-file');
    const canvas = document.getElementById('dxf-canvas');
    const ctx = canvas.getContext('2d');

    const unitSelect = document.getElementById('unit-select');
    const materialSelect = document.getElementById('material-select');
    const thicknessSelect = document.getElementById('thickness-select');
    const calculateBtn = document.getElementById('calculate-btn');

    // State
    let currentDxf = null;
    let totalLengthMm = 0;
    let canvasZoom = 1.0;
    let canvasOffsetX = 0;
    let canvasOffsetY = 0;

    // Configuration Data
    // Cutting Speed (m/s) - Meters per second
    const cuttingSpeeds = {
        hierro: {
            '0.5': 0.25, '0.8': 0.24, '1': 0.233, '1.2': 0.22, '1.5': 0.20,
            '2': 0.15, '2.5': 0.13, '3': 0.117, '4': 0.08, '5': 0.02,
            '6': 0.015, '8': 0.008, '10': 0.003, '12': 0.002, '15': 0.00167, '20': 0.001
        },
        inox: {
            '0.5': 0.025, '0.8': 0.024, '1': 0.023, '1.2': 0.02, '1.5': 0.015,
            '2': 0.01, '2.5': 0.008, '3': 0.0067, '4': 0.005, '5': 0.0038,
            '6': 0.003, '8': 0.0025, '10': 0.0022, '12': 0.0018, '15': 0.0013, '20': 0.00075
        },
        aluminio: {
            '0.5': 0.022, '0.8': 0.021, '1': 0.02, '1.2': 0.018, '1.5': 0.016,
            '2': 0.014, '2.5': 0.155, '3': 0.15, '4': 0.01, '5': 0.0058,
            '6': 0.0045, '8': 0.0037, '10': 0.0033, '12': 0.0028, '15': 0.0022
        },
        galvanizado: {
            '0.5': 0.018, '0.8': 0.017, '1': 0.016, '1.2': 0.014, '1.5': 0.012,
            '2': 0.011, '2.5': 0.009, '3': 0.008, '4': 0.006, '5': 0.0047,
            '6': 0.0037, '8': 0.003, '10': 0.0027, '12': 0.0022, '15': 0.0016
        }
    };

    const COST_PER_MINUTE = 5.00; // USD per minute of machine time
    const MINIMUM_PRICE = 50.00; // USD - Setup + piercing base cost

    // --- Event Listeners ---

    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith('.dxf')) {
            handleFile(file);
        } else {
            alert('Por favor, sube un archivo .dxf válido.');
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    removeFileBtn.addEventListener('click', () => {
        currentDxf = null;
        fileInput.value = '';
        previewContainer.style.display = 'none';
        dropZone.style.display = 'block';
        updateResults(0);
    });

    calculateBtn.addEventListener('click', () => {
        if (currentDxf) {
            recalculate();
        }
    });

    // Auto-recalculate on config change
    [unitSelect, materialSelect, thicknessSelect].forEach(el => {
        el.addEventListener('change', () => {
            if (currentDxf) recalculate();
        });
    });

    // Populate Thickness initially
    updateThicknessOptions();
    materialSelect.addEventListener('change', updateThicknessOptions);

    function updateThicknessOptions() {
        const material = materialSelect.value;
        const speeds = cuttingSpeeds[material];
        thicknessSelect.innerHTML = '';
        Object.keys(speeds).forEach(t => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = `${t}.0 mm`;
            thicknessSelect.appendChild(option);
        });
    }

    // --- Core Logic ---

    function handleFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parser = new DxfParser();
                const dxfData = parser.parseSync(e.target.result);

                // Validate DXF data
                if (!dxfData || !dxfData.entities || dxfData.entities.length === 0) {
                    alert('El archivo DXF parece estar vacío o no contiene entidades válidas.');
                    return;
                }

                currentDxf = dxfData;

                dropZone.style.display = 'none';
                previewContainer.style.display = 'block';
                fileNameDisplay.textContent = file.name;

                // Reset zoom and pan
                canvasZoom = 1.0;
                canvasOffsetX = 0;
                canvasOffsetY = 0;

                // Add zoom and pan event listeners
                canvas.addEventListener('wheel', handleCanvasZoom, { passive: false });

                let isPanning = false;
                let startX = 0, startY = 0;

                canvas.addEventListener('mousedown', (e) => {
                    isPanning = true;
                    startX = e.clientX - canvasOffsetX;
                    startY = e.clientY - canvasOffsetY;
                    canvas.style.cursor = 'grabbing';
                });

                canvas.addEventListener('mousemove', (e) => {
                    if (!isPanning) return;
                    canvasOffsetX = e.clientX - startX;
                    canvasOffsetY = e.clientY - startY;
                    renderDXF(currentDxf.entities, unitSelect.value === 'in');
                });

                canvas.addEventListener('mouseup', () => {
                    isPanning = false;
                    canvas.style.cursor = 'grab';
                });

                canvas.addEventListener('mouseleave', () => {
                    isPanning = false;
                    canvas.style.cursor = 'grab';
                });

                canvas.style.cursor = 'grab';

                recalculate();

                // Log entity types for debugging
                const entityTypes = {};
                dxfData.entities.forEach(e => {
                    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
                });
                console.log('DXF cargado. Entidades:', entityTypes);

            } catch (err) {
                console.error('Error detallado:', err);
                alert(`Error al leer el archivo DXF:\n\n${err.message}\n\nAsegúrate de que sea un archivo DXF válido en formato ASCII (no binario).`);
            }
        };

        reader.onerror = () => {
            alert('Error al leer el archivo. Por favor intenta de nuevo.');
        };

        reader.readAsText(file);
    }

    function handleCanvasZoom(e) {
        e.preventDefault();

        const zoomIntensity = 0.1;
        const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;

        const oldZoom = canvasZoom;
        canvasZoom = Math.max(0.5, Math.min(5.0, canvasZoom + delta));

        // Adjust offset to zoom towards mouse position
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomRatio = canvasZoom / oldZoom;
        canvasOffsetX = mouseX - (mouseX - canvasOffsetX) * zoomRatio;
        canvasOffsetY = mouseY - (mouseY - canvasOffsetY) * zoomRatio;

        if (currentDxf) {
            renderDXF(currentDxf.entities, unitSelect.value === 'in');
        }
    }

    function recalculate() {
        if (!currentDxf) return;

        // 1. Calculate raw length from entities
        const rawLength = calculateRawLength(currentDxf.entities);

        // 2. Apply Unit Conversion
        const isInches = unitSelect.value === 'in';
        totalLengthMm = isInches ? rawLength * 25.4 : rawLength;

        // 3. Render Preview
        renderDXF(currentDxf.entities, isInches);

        // 4. Update Stats UI
        document.getElementById('stat-length').textContent = (totalLengthMm / 1000).toFixed(2) + ' m';

        // 5. Calculate Price
        calculatePrice();
    }

    function calculatePrice() {
        const material = materialSelect.value;
        const thickness = thicknessSelect.value;
        const speedMS = cuttingSpeeds[material][thickness]; // m/s

        if (!speedMS) return;

        // Calculate rapid move distance (between separate cuts)
        const rapidDistanceMm = calculateRapidMoves(currentDxf.entities);
        const rapidSpeedMS = 0.25; // 0.25 m/s = 15,000 mm/min (typical rapid speed)
        const rapidTimeSeconds = (rapidDistanceMm / 1000) / rapidSpeedMS;

        // Cutting time: Distance (mm) / Speed (m/s) = Time (seconds)
        const totalLengthMeters = totalLengthMm / 1000;
        const cuttingTimeSeconds = totalLengthMeters / speedMS;

        // Total time = cutting + rapid moves + 30% overhead
        const baseTimeSeconds = cuttingTimeSeconds + rapidTimeSeconds;
        const totalTimeSeconds = baseTimeSeconds * 1.30;

        // Convert to minutes and always round UP
        const totalTimeMinutes = totalTimeSeconds / 60;
        const roundedTimeMinutes = Math.ceil(totalTimeMinutes);

        // Price = (Time * Rate) + Setup Fee
        const cuttingCost = roundedTimeMinutes * COST_PER_MINUTE;
        const totalPrice = Math.max(cuttingCost, MINIMUM_PRICE);

        // Update UI
        document.getElementById('est-time').textContent = roundedTimeMinutes + ' min';
        document.getElementById('total-price').textContent = '$' + totalPrice.toFixed(2);

        // Update WhatsApp link with quote details
        updateWhatsAppLink(material, thickness, roundedTimeMinutes, totalPrice);
    }

    function calculateRapidMoves(entities) {
        // Estimate rapid move distance by calculating distances between entity centers
        let totalRapidDistance = 0;

        for (let i = 0; i < entities.length - 1; i++) {
            const center1 = getEntityCenter(entities[i]);
            const center2 = getEntityCenter(entities[i + 1]);

            if (center1 && center2) {
                totalRapidDistance += distance(center1, center2);
            }
        }

        return totalRapidDistance;
    }

    function getEntityCenter(entity) {
        if (entity.center) {
            return entity.center; // Circle/Arc
        } else if (entity.vertices && entity.vertices.length > 0) {
            // Calculate centroid of polyline/line
            let sumX = 0, sumY = 0;
            entity.vertices.forEach(v => {
                sumX += v.x;
                sumY += v.y;
            });
            return { x: sumX / entity.vertices.length, y: sumY / entity.vertices.length };
        }
        return null;
    }

    function updateWhatsAppLink(material, thickness, timeMinutes, price) {
        const fileName = fileNameDisplay.textContent || 'archivo.dxf';
        const lengthMeters = (totalLengthMm / 1000).toFixed(2);
        const units = unitSelect.value === 'mm' ? 'Milímetros' : 'Pulgadas';

        // Get material name properly
        const materialNames = {
            'hierro': 'HIERRO NEGRO',
            'inox': 'ACERO INOXIDABLE',
            'aluminio': 'ALUMINIO',
            'galvanizado': 'GALVANIZADO'
        };
        const materialName = materialNames[material] || material.toUpperCase();

        // Build WhatsApp message - Simple format, no special characters
        const lines = [
            'Hola! Quisiera confirmar el precio de este corte laser:',
            '',
            'ARCHIVO: ' + fileName,
            'LONGITUD DE CORTE: ' + lengthMeters + ' m',
            'UNIDADES: ' + units,
            'MATERIAL: ' + materialName,
            'ESPESOR: ' + thickness + ' mm',
            'TIEMPO ESTIMADO: ' + timeMinutes + ' min',
            'PRECIO APROXIMADO: $' + price.toFixed(2),
            '',
            'Pueden confirmarme el precio exacto?'
        ];

        const message = lines.join('%0A');
        const whatsappBtn = document.getElementById('whatsapp-btn');
        whatsappBtn.href = `https://wa.me/584126392512?text=${message}`;
    }

    // --- Geometry & Math ---

    function calculateRawLength(entities) {
        let length = 0;
        let unsupportedCount = 0;

        entities.forEach(entity => {
            try {
                switch (entity.type) {
                    case 'LINE':
                        if (entity.vertices && entity.vertices.length >= 2) {
                            length += distance(entity.vertices[0], entity.vertices[1]);
                        }
                        break;
                    case 'CIRCLE':
                        if (entity.radius) {
                            length += 2 * Math.PI * entity.radius;
                        }
                        break;
                    case 'ARC':
                        if (entity.radius) {
                            let angle = entity.endAngle - entity.startAngle;
                            if (angle < 0) angle += 2 * Math.PI;
                            length += entity.radius * angle;
                        }
                        break;
                    case 'LWPOLYLINE':
                    case 'POLYLINE':
                        if (entity.vertices && entity.vertices.length > 1) {
                            for (let i = 0; i < entity.vertices.length - 1; i++) {
                                length += distance(entity.vertices[i], entity.vertices[i + 1]);
                            }
                            // If closed, add last segment
                            if (entity.shape || entity.closed) {
                                length += distance(entity.vertices[entity.vertices.length - 1], entity.vertices[0]);
                            }
                        }
                        break;
                    case 'SPLINE':
                        // Approximate spline with control points
                        if (entity.controlPoints && entity.controlPoints.length > 1) {
                            for (let i = 0; i < entity.controlPoints.length - 1; i++) {
                                length += distance(entity.controlPoints[i], entity.controlPoints[i + 1]);
                            }
                        }
                        break;
                    case 'ELLIPSE':
                        // Approximate ellipse as circle using major radius
                        if (entity.majorAxisEndPoint) {
                            const majorRadius = Math.sqrt(
                                Math.pow(entity.majorAxisEndPoint.x, 2) +
                                Math.pow(entity.majorAxisEndPoint.y, 2)
                            );
                            length += 2 * Math.PI * majorRadius;
                        }
                        break;
                    default:
                        unsupportedCount++;
                        console.warn('Tipo de entidad no soportada para cálculo:', entity.type);
                }
            } catch (err) {
                console.error('Error calculando longitud de entidad:', entity.type, err);
            }
        });

        if (unsupportedCount > 0) {
            console.warn(`${unsupportedCount} entidades no fueron incluidas en el cálculo de longitud.`);
        }

        return length;
    }

    function distance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    // --- Canvas Rendering ---

    function renderDXF(entities, isInches) {
        if (!entities || entities.length === 0) return;

        // Reset Canvas with proper dimensions
        const containerWidth = canvas.parentElement.offsetWidth;
        canvas.width = containerWidth > 0 ? containerWidth : 600;
        canvas.height = 400;

        // Clear with dark background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 1. Calculate Bounding Box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Helper to update bounds
        const updateBounds = (x, y) => {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        };

        // Iterate to find bounds (simplified for common entities)
        entities.forEach(entity => {
            if (entity.vertices) {
                entity.vertices.forEach(v => updateBounds(v.x, v.y));
            } else if (entity.center) { // Circle/Arc
                updateBounds(entity.center.x - entity.radius, entity.center.y - entity.radius);
                updateBounds(entity.center.x + entity.radius, entity.center.y + entity.radius);
            }
        });

        if (minX === Infinity) return; // Empty drawing

        // 2. Calculate Scale
        const drawingWidth = maxX - minX;
        const drawingHeight = maxY - minY;

        // Update Stats Dimensions
        const widthMm = isInches ? drawingWidth * 25.4 : drawingWidth;
        const heightMm = isInches ? drawingHeight * 25.4 : drawingHeight;
        document.getElementById('stat-width').textContent = widthMm.toFixed(0) + ' mm';
        document.getElementById('stat-height').textContent = heightMm.toFixed(0) + ' mm';

        // Fit to canvas with padding
        const padding = 20;
        const scaleX = (canvas.width - padding * 2) / drawingWidth;
        const scaleY = (canvas.height - padding * 2) / drawingHeight;
        const baseScale = Math.min(scaleX, scaleY);
        const scale = baseScale * canvasZoom; // Apply zoom

        const baseOffsetX = (canvas.width - drawingWidth * scale) / 2 - minX * scale;
        const baseOffsetY = (canvas.height - drawingHeight * scale) / 2 + maxY * scale;

        const offsetX = baseOffsetX + canvasOffsetX;
        const offsetY = baseOffsetY + canvasOffsetY;

        // 3. Draw
        ctx.strokeStyle = '#E6007E'; // Vima Pink
        ctx.lineWidth = 2;
        ctx.beginPath();

        entities.forEach(entity => {
            try {
                // Transform coordinates
                const tx = (x) => x * scale + offsetX;
                const ty = (y) => -y * scale + offsetY; // Flip Y

                if (entity.type === 'LINE') {
                    if (entity.vertices && entity.vertices.length >= 2) {
                        ctx.moveTo(tx(entity.vertices[0].x), ty(entity.vertices[0].y));
                        ctx.lineTo(tx(entity.vertices[1].x), ty(entity.vertices[1].y));
                    }
                }
                else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    if (entity.vertices && entity.vertices.length > 0) {
                        ctx.moveTo(tx(entity.vertices[0].x), ty(entity.vertices[0].y));
                        for (let i = 1; i < entity.vertices.length; i++) {
                            ctx.lineTo(tx(entity.vertices[i].x), ty(entity.vertices[i].y));
                        }
                        if (entity.shape || entity.closed) {
                            ctx.lineTo(tx(entity.vertices[0].x), ty(entity.vertices[0].y));
                        }
                    }
                }
                else if (entity.type === 'CIRCLE') {
                    if (entity.center && entity.radius) {
                        ctx.moveTo(tx(entity.center.x) + entity.radius * scale, ty(entity.center.y));
                        ctx.arc(tx(entity.center.x), ty(entity.center.y), entity.radius * scale, 0, 2 * Math.PI);
                    }
                }
                else if (entity.type === 'ARC') {
                    if (entity.center && entity.radius) {
                        ctx.moveTo(tx(entity.center.x) + Math.cos(entity.startAngle) * entity.radius * scale,
                            ty(entity.center.y) - Math.sin(entity.startAngle) * entity.radius * scale);
                        // Note: This arc drawing might be imperfect due to coordinate flip, but sufficient for preview
                        ctx.arc(tx(entity.center.x), ty(entity.center.y), entity.radius * scale,
                            2 * Math.PI - entity.endAngle, 2 * Math.PI - entity.startAngle);
                    }
                }
                else if (entity.type === 'ELLIPSE') {
                    if (entity.center && entity.majorAxisEndPoint) {
                        const majorRadius = Math.sqrt(
                            Math.pow(entity.majorAxisEndPoint.x, 2) +
                            Math.pow(entity.majorAxisEndPoint.y, 2)
                        );
                        const minorRadius = majorRadius * (entity.axisRatio || 1);
                        ctx.ellipse(
                            tx(entity.center.x),
                            ty(entity.center.y),
                            majorRadius * scale,
                            minorRadius * scale,
                            0, 0, 2 * Math.PI
                        );
                    }
                }
            } catch (err) {
                console.error('Error dibujando entidad:', entity.type, err);
            }
        });

        ctx.stroke();
    }
});
