<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'

import type { CellInfo, SampleAlgorithmId, SampleAnchor, SamplePoint, SampleRegionInfo, SelectedCell } from '../types'

const props = defineProps({
  sourceCanvas: {
    type: Object as PropType<HTMLCanvasElement | null>,
    default: null,
  },
  selectedCell: {
    type: Object as PropType<SelectedCell>,
    default: null,
  },
  selectedInfo: {
    type: Object as PropType<CellInfo | null>,
    default: null,
  },
  selectedAnchor: {
    type: Object as PropType<SampleAnchor | null>,
    default: null,
  },
  selectedSampleRegion: {
    type: Object as PropType<SampleRegionInfo | null>,
    default: null,
  },
  selectedAlgorithm: {
    type: String as PropType<SampleAlgorithmId>,
    default: 'anchor-point',
  },
  selectedSamplePoints: {
    type: Array as PropType<SamplePoint[]>,
    default: () => [],
  },
  renderKey: {
    type: Number,
    required: true,
  },
})

const emit = defineEmits<{
  addSamplePoint: [point: SamplePoint]
  updateSamplePoint: [point: { index: number; point: SamplePoint }]
  updateAnchorPoint: [point: SampleAnchor]
  previewManualColor: [color: string]
  commitManualColor: [color: string]
  endManualColorPreview: []
  startPointDrag: []
  endPointDrag: []
}>()

const shellRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasStyle = ref<Record<string, string>>({})
const panX = ref(0)
const panY = ref(0)
const zoom = ref(1)
let resizeObserver: ResizeObserver | null = null
const draggingPointIndex = ref<number | null>(null)

const MIN_ZOOM = 0.5
const MAX_ZOOM = 24

const algorithmLabels = {
  'anchor-point': '单点采样',
  'multi-point-average': '多点平均',
  'cell-average': '整格平均',
}

const PREVIEW_POINT_RESOLUTION = 24
const PREVIEW_GRID_VISIBLE_LIMIT = 16

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function updateCanvasLayout() {
  const canvas = canvasRef.value
  const shell = shellRef.value
  if (!canvas || !shell || !canvas.width || !canvas.height) {
    return
  }
  const bounds = shell.getBoundingClientRect()
  const maxWidth = Math.max(1, bounds.width * 0.95)
  const maxHeight = Math.max(1, bounds.height * 0.95)
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
  canvasStyle.value = {
    width: `${Math.max(1, canvas.width * scale)}px`,
    height: `${Math.max(1, canvas.height * scale)}px`,
    transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
    transformOrigin: 'top left',
  }
}

function drawPlaceholder(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string) {
  canvas.width = 420
  canvas.height = 220
  updateCanvasLayout()
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#0c1324'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(223, 233, 252, 0.75)'
  context.font = '15px sans-serif'
  context.textAlign = 'center'
  context.fillText(text, canvas.width / 2, canvas.height / 2)
}

function getRegionMetrics() {
  const region = props.selectedSampleRegion
  if (!region) {
    return null
  }
  const regionWidth = Math.max(1, region.endX - region.startX + 1)
  const regionHeight = Math.max(1, region.endY - region.startY + 1)
  const previewColumns = Math.max(regionWidth, PREVIEW_POINT_RESOLUTION)
  const previewRows = Math.max(regionHeight, PREVIEW_POINT_RESOLUTION)
  return {
    regionWidth,
    regionHeight,
    previewColumns,
    previewRows,
    pixelWidth: Math.max(1, canvasRef.value?.width ?? 0) / previewColumns,
    pixelHeight: Math.max(1, canvasRef.value?.height ?? 0) / previewRows,
    regionPixelWidth: Math.max(1, canvasRef.value?.width ?? 0) / regionWidth,
    regionPixelHeight: Math.max(1, canvasRef.value?.height ?? 0) / regionHeight,
  }
}

function resolvePreviewPoint(event: PointerEvent | MouseEvent) {
  const canvas = canvasRef.value
  const region = props.selectedSampleRegion
  const metrics = getRegionMetrics()
  if (!canvas || !region || !metrics || region.algorithmId === 'cell-average') {
    return null
  }

  const rect = canvas.getBoundingClientRect()
  const localX = clamp(((event.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width)
  const localY = clamp(((event.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height)
  const previewX = clamp(Math.floor(localX / metrics.pixelWidth), 0, metrics.previewColumns - 1)
  const previewY = clamp(Math.floor(localY / metrics.pixelHeight), 0, metrics.previewRows - 1)
  return {
    x: clamp((previewX + 0.5) / metrics.previewColumns, 0, 1),
    y: clamp((previewY + 0.5) / metrics.previewRows, 0, 1),
  }
}

function addPointFromEvent(event: PointerEvent | MouseEvent) {
  const point = resolvePreviewPoint(event)
  if (!point || props.selectedAlgorithm !== 'multi-point-average') {
    return
  }
  emit('addSamplePoint', { x: point.x, y: point.y })
}

function getDisplayedSamplePixels() {
  if (!props.selectedInfo) {
    return [] as Array<{ x: number; y: number }>
  }
  if (props.selectedAlgorithm === 'anchor-point') {
    return [{ x: Math.round(props.selectedInfo.sampleX), y: Math.round(props.selectedInfo.sampleY) }]
  }
  if (props.selectedAlgorithm === 'multi-point-average') {
    return props.selectedInfo.samplePoints.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
  }
  return [] as Array<{ x: number; y: number }>
}

function getMarkerMetrics(canvas: HTMLCanvasElement) {
  const displayScale = Math.max(0.001, canvas.getBoundingClientRect().width / Math.max(1, canvas.width))
  return {
    radius: clamp(7 / displayScale, 0.45, 5),
    lineWidth: clamp(2 / displayScale, 0.4, 2),
    threshold: clamp(12 / displayScale, 1.2, 12),
  }
}

function findPointIndex(event: PointerEvent) {
  const canvas = canvasRef.value
  const region = props.selectedSampleRegion
  const metrics = getRegionMetrics()
  if (!canvas || !region || !metrics || props.selectedAlgorithm === 'cell-average') {
    return -1
  }
  const rect = canvas.getBoundingClientRect()
  const localX = ((event.clientX - rect.left) / rect.width) * canvas.width
  const localY = ((event.clientY - rect.top) / rect.height) * canvas.height
  const threshold = getMarkerMetrics(canvas).threshold
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  getDisplayedSamplePixels().forEach((point, index) => {
    const x = (((point.x - region.startX + 0.5) / metrics.regionWidth) * metrics.previewColumns) * metrics.pixelWidth
    const y = (((point.y - region.startY + 0.5) / metrics.regionHeight) * metrics.previewRows) * metrics.pixelHeight
    const distance = Math.hypot(localX - x, localY - y)
    if (distance <= threshold && distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  })
  return nearestIndex
}

function onPointerDown(event: PointerEvent) {
  if (props.selectedAlgorithm === 'cell-average' || event.button === 2) {
    return
  }
  const pointIndex = findPointIndex(event)
  if (event.button === 0 && pointIndex >= 0) {
    draggingPointIndex.value = pointIndex
    emit('startPointDrag')
    try {
      canvasRef.value?.setPointerCapture(event.pointerId)
    } catch {}
    return
  }
  if (event.button === 0 && props.selectedAlgorithm === 'multi-point-average') {
    addPointFromEvent(event)
  }
}

function onPointerMove(event: PointerEvent) {
  if (draggingPointIndex.value === null) {
    return
  }
  const point = resolvePreviewPoint(event)
  if (!point) {
    return
  }
  if (props.selectedAlgorithm === 'anchor-point') {
    emit('updateAnchorPoint', point)
    return
  }
  emit('updateSamplePoint', { index: draggingPointIndex.value, point: { x: point.x, y: point.y } })
}

function onPointerUp(event?: PointerEvent) {
  try {
    if (event && canvasRef.value?.hasPointerCapture(event.pointerId)) {
      canvasRef.value.releasePointerCapture(event.pointerId)
    }
  } catch {
    return
  }
  if (draggingPointIndex.value === null) {
    return
  }
  draggingPointIndex.value = null
  emit('endPointDrag')
}

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  addPointFromEvent(event)
}

function onManualColorInput(event: Event) {
  emit('previewManualColor', (event.target as HTMLInputElement).value)
}

function onManualColorCommit(event: Event) {
  emit('commitManualColor', (event.target as HTMLInputElement).value)
}

function onManualColorPointerEnd() {
  emit('endManualColorPreview')
}

function onWheel(event: WheelEvent) {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }
  event.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const anchorX = localX / zoom.value
  const anchorY = localY / zoom.value
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value * factor))
  if (nextZoom === zoom.value) {
    return
  }
  panX.value += localX - anchorX * nextZoom
  panY.value += localY - anchorY * nextZoom
  zoom.value = nextZoom
  updateCanvasLayout()
}

function draw() {
  const canvas = canvasRef.value
  const sourceCanvas = props.sourceCanvas
  const region = props.selectedSampleRegion
  if (!canvas) {
    return
  }
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  if (!sourceCanvas || !props.selectedCell || !props.selectedInfo || !region) {
    drawPlaceholder(context, canvas, '选中像素后显示采样区域')
    return
  }

  const metrics = getRegionMetrics()
  if (!metrics) {
    drawPlaceholder(context, canvas, '选中像素后显示采样区域')
    return
  }
  const scale = Math.min(18, Math.max(4, Math.floor(Math.min(420 / metrics.regionWidth, 260 / metrics.regionHeight))))
  const canvasWidth = metrics.previewColumns * scale
  const canvasHeight = metrics.previewRows * scale
  const pixelWidth = canvasWidth / metrics.previewColumns
  const pixelHeight = canvasHeight / metrics.previewRows

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  updateCanvasLayout()
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  context.drawImage(sourceCanvas, region.startX, region.startY, metrics.regionWidth, metrics.regionHeight, 0, 0, canvas.width, canvas.height)

  context.strokeStyle = 'rgba(125, 211, 252, 0.9)'
  context.lineWidth = 2
  context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)

  if (metrics.regionWidth <= PREVIEW_GRID_VISIBLE_LIMIT && metrics.regionHeight <= PREVIEW_GRID_VISIBLE_LIMIT) {
    context.save()
    context.strokeStyle = 'rgba(224, 242, 254, 0.22)'
    context.lineWidth = 0.5
    for (let x = 1; x < metrics.regionWidth; x += 1) {
      const px = Math.round((x / metrics.regionWidth) * canvas.width) + 0.5
      context.beginPath()
      context.moveTo(px, 0)
      context.lineTo(px, canvas.height)
      context.stroke()
    }
    for (let y = 1; y < metrics.regionHeight; y += 1) {
      const py = Math.round((y / metrics.regionHeight) * canvas.height) + 0.5
      context.beginPath()
      context.moveTo(0, py)
      context.lineTo(canvas.width, py)
      context.stroke()
    }
    context.restore()
  }

  if (region.algorithmId === 'cell-average') {
    context.fillStyle = 'rgba(125, 211, 252, 0.16)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return
  }

  const displayedPixels = getDisplayedSamplePixels()
  const { radius, lineWidth } = getMarkerMetrics(canvas)
  for (const point of displayedPixels) {
    const x = (((point.x - region.startX + 0.5) / metrics.regionWidth) * metrics.previewColumns) * pixelWidth
    const y = (((point.y - region.startY + 0.5) / metrics.regionHeight) * metrics.previewRows) * pixelHeight
    context.beginPath()
    context.fillStyle = '#f8fbff'
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
    context.lineWidth = lineWidth
    context.strokeStyle = '#0f172a'
    context.stroke()
  }
}

watch(() => [
  props.renderKey,
  props.selectedCell?.x,
  props.selectedCell?.y,
  props.selectedInfo?.hex,
  props.selectedInfo?.sampleX,
  props.selectedInfo?.sampleY,
  props.selectedSampleRegion?.startX,
  props.selectedSampleRegion?.startY,
  props.selectedSampleRegion?.endX,
  props.selectedSampleRegion?.endY,
  props.selectedSamplePoints.length,
  props.sourceCanvas,
], draw)
onMounted(() => {
  draw()
  resizeObserver = new ResizeObserver(() => updateCanvasLayout())
  if (shellRef.value) {
    resizeObserver.observe(shellRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="panel glass-panel stack-sm">
    <div class="panel-header compact">
      <div>
        <h2>选中采样区域</h2>
        <p>
          {{ selectedSampleRegion ? `${algorithmLabels[selectedSampleRegion.algorithmId]} · ${selectedSampleRegion.endX - selectedSampleRegion.startX + 1} × ${selectedSampleRegion.endY - selectedSampleRegion.startY + 1}${selectedAlgorithm === 'multi-point-average' ? ' · 点击/右键添加点' : selectedAlgorithm === 'anchor-point' ? ' · 拖动采样点' : ''}` : '只显示当前选中格对应的原图区域。' }}
        </p>
      </div>
      <label v-if="selectedInfo" class="preview-color-chip preview-color-label">
        <span class="preview-color-swatch" :style="{ background: selectedInfo.hex }"></span>
        <strong>{{ selectedInfo.isManualColor ? `${selectedInfo.hex} · 手动` : selectedInfo.color }}</strong>
        <input class="preview-color-input" type="color" name="manual-color" :value="selectedInfo.hex" @input="onManualColorInput" @change="onManualColorCommit" @pointerup="onManualColorPointerEnd" @pointercancel="onManualColorPointerEnd" />
      </label>
    </div>
    <div ref="shellRef" class="canvas-shell sample-preview-shell" @wheel.prevent="onWheel">
      <div class="canvas-stage static-stage sample-preview-stage">
        <canvas ref="canvasRef" class="canvas-element sample-preview-canvas" :style="canvasStyle" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @lostpointercapture="onPointerUp" @contextmenu="onContextMenu" />
      </div>
    </div>
  </section>
</template>
