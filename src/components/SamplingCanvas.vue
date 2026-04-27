<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'

import type { CellSampleConfig, SampleAnchor, SamplingArea, SelectedCell } from '../types'

const props = defineProps({
  sourceCanvas: {
    type: Object as PropType<HTMLCanvasElement | null>,
    default: null,
  },
  cellConfigs: {
    type: Array as PropType<CellSampleConfig[][]>,
    default: () => [],
  },
  outputWidth: {
    type: Number,
    required: true,
  },
  outputHeight: {
    type: Number,
    required: true,
  },
  selectedCell: {
    type: Object as PropType<SelectedCell>,
    default: null,
  },
  samplingArea: {
    type: Object as PropType<SamplingArea>,
    required: true,
  },
  showGrid: {
    type: Boolean,
    default: true,
  },
  showSamplePoints: {
    type: Boolean,
    default: true,
  },
  renderKey: {
    type: Number,
    required: true,
  },
})

const emit = defineEmits<{
  select: [cell: { x: number; y: number }]
  dragAnchorStart: [cell: { x: number; y: number }]
  updateAnchor: [payload: { cell: { x: number; y: number }; anchor: SampleAnchor }]
  dragAnchorEnd: []
  resetAnchor: [cell: { x: number; y: number }]
  samplingAreaChangeStart: []
  updateSamplingArea: [area: SamplingArea]
  samplingAreaChangeEnd: []
}>()

const viewportRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasStyle = ref<Record<string, string>>({})
const draggingCell = ref<SelectedCell>(null)
const panning = ref(false)
const spacePressed = ref(false)
const panX = ref(0)
const panY = ref(0)
const zoom = ref(1)
const startPointerX = ref(0)
const startPointerY = ref(0)
const startPanX = ref(0)
const startPanY = ref(0)
const areaAction = ref<'move' | 'resize' | null>(null)
const areaHandle = ref<string>('')
const hoverAreaAction = ref<'move' | 'resize' | null>(null)
const hoverAreaHandle = ref<string>('')
const startArea = ref<SamplingArea>({ x: 0, y: 0, width: 1, height: 1 })

const MIN_ZOOM = 0.5
const MAX_ZOOM = 24
const TARGET_CELL_SIZE = 18
const MAX_BASE_SCALE = 32
const MAX_DISPLAY_WIDTH = 880
const MAX_DISPLAY_HEIGHT = 560

const stageStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  cursor: resolveCursor(),
}))

function resolveCursor() {
  if (panning.value || areaAction.value === 'move') {
    return 'grabbing'
  }
  if (areaAction.value === 'resize') {
    return resizeCursor(areaHandle.value)
  }
  if (spacePressed.value) {
    return 'grab'
  }
  if (hoverAreaAction.value === 'resize') {
    return resizeCursor(hoverAreaHandle.value)
  }
  if (hoverAreaAction.value === 'move') {
    return 'grab'
  }
  return 'crosshair'
}

function resizeCursor(handle: string) {
  if (handle === 'nw' || handle === 'se') {
    return 'nwse-resize'
  }
  if (handle === 'ne' || handle === 'sw') {
    return 'nesw-resize'
  }
  if (handle === 'n' || handle === 's') {
    return 'ns-resize'
  }
  if (handle === 'w' || handle === 'e') {
    return 'ew-resize'
  }
  return 'move'
}

function getDisplayScale(width: number, height: number) {
  const viewport = viewportRef.value
  if (!viewport) {
    return 1
  }
  const bounds = viewport.getBoundingClientRect()
  const viewportWidth = Math.max(1, bounds.width - 32)
  const viewportHeight = Math.max(1, bounds.height - 32)
  const maxWidth = Math.min(viewportWidth, MAX_DISPLAY_WIDTH)
  const maxHeight = Math.min(viewportHeight, MAX_DISPLAY_HEIGHT)
  const fitScale = Math.min(maxWidth / width, maxHeight / height)
  const cellWidth = Math.max(1, props.samplingArea.width / Math.max(1, props.outputWidth))
  const cellHeight = Math.max(1, props.samplingArea.height / Math.max(1, props.outputHeight))
  const readableScale = TARGET_CELL_SIZE / Math.min(cellWidth, cellHeight)
  const canUpscaleWholeImage = width <= maxWidth && height <= maxHeight
  const baseScale = canUpscaleWholeImage ? Math.max(fitScale, readableScale) : fitScale
  return clamp(baseScale, 0.01, MAX_BASE_SCALE)
}

function updateCanvasLayout(width: number, height: number) {
  const scale = getDisplayScale(width, height)
  canvasStyle.value = {
    width: `${Math.max(1, width * scale)}px`,
    height: `${Math.max(1, height * scale)}px`,
  }
}

function isSelectedCell(x: number, y: number) {
  return props.selectedCell?.x === x && props.selectedCell?.y === y
}

function getAreaRect(scale: number) {
  return {
    x: props.samplingArea.x * scale,
    y: props.samplingArea.y * scale,
    width: props.samplingArea.width * scale,
    height: props.samplingArea.height * scale,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getPointMetrics() {
  const sourceCanvas = props.sourceCanvas
  if (!sourceCanvas) {
    return {
      radius: 3,
      selectedRadius: 4.5,
      lineWidth: 1.5,
    }
  }
  const displayScale = getDisplayScale(sourceCanvas.width, sourceCanvas.height) * zoom.value
  return {
    radius: clamp(3 / displayScale, 1.2, 6),
    selectedRadius: clamp(4.5 / displayScale, 1.8, 8),
    lineWidth: clamp(1.5 / displayScale, 0.8, 2.4),
  }
}

function drawPoint(context: CanvasRenderingContext2D, x: number, y: number, selected: boolean) {
  const metrics = getPointMetrics()
  context.beginPath()
  context.fillStyle = selected ? '#8ce3ff' : '#f8fbff'
  context.arc(x, y, selected ? metrics.selectedRadius : metrics.radius, 0, Math.PI * 2)
  context.fill()
  context.lineWidth = metrics.lineWidth
  context.strokeStyle = selected ? '#0f172a' : 'rgba(15, 23, 42, 0.92)'
  context.stroke()
}

function draw() {
  const canvas = canvasRef.value
  const sourceCanvas = props.sourceCanvas
  if (!canvas) {
    return
  }
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  if (!sourceCanvas) {
    canvas.width = 640
    canvas.height = 420
    canvasStyle.value = {}
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#0c1324'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(223, 233, 252, 0.75)'
    context.font = '16px sans-serif'
    context.textAlign = 'center'
    context.fillText('导入图片后，这里会显示采样视图', canvas.width / 2, canvas.height / 2)
    return
  }

  canvas.width = sourceCanvas.width
  canvas.height = sourceCanvas.height
  updateCanvasLayout(sourceCanvas.width, sourceCanvas.height)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height)

  const areaRect = getAreaRect(1)
  const cellWidth = areaRect.width / props.outputWidth
  const cellHeight = areaRect.height / props.outputHeight

  context.save()
  context.fillStyle = 'rgba(2, 6, 23, 0.48)'
  context.beginPath()
  context.rect(0, 0, canvas.width, canvas.height)
  context.rect(areaRect.x, areaRect.y, areaRect.width, areaRect.height)
  context.fill('evenodd')
  context.restore()
  context.strokeStyle = '#7dd3fc'
  context.lineWidth = 2
  context.strokeRect(areaRect.x + 1, areaRect.y + 1, areaRect.width - 2, areaRect.height - 2)
  for (const [handleX, handleY] of [[areaRect.x, areaRect.y], [areaRect.x + areaRect.width, areaRect.y], [areaRect.x, areaRect.y + areaRect.height], [areaRect.x + areaRect.width, areaRect.y + areaRect.height]]) {
    context.fillStyle = '#e0f2fe'
    context.fillRect(handleX - 4, handleY - 4, 8, 8)
    context.strokeStyle = '#0f172a'
    context.strokeRect(handleX - 4, handleY - 4, 8, 8)
  }

  if (props.showGrid) {
    context.strokeStyle = 'rgba(230, 238, 255, 0.3)'
    context.lineWidth = 1
    for (let x = 0; x <= props.outputWidth; x += 1) {
      const px = Math.round(areaRect.x + x * cellWidth) + 0.5
      context.beginPath()
      context.moveTo(px, areaRect.y)
      context.lineTo(px, areaRect.y + areaRect.height)
      context.stroke()
    }
    for (let y = 0; y <= props.outputHeight; y += 1) {
      const py = Math.round(areaRect.y + y * cellHeight) + 0.5
      context.beginPath()
      context.moveTo(areaRect.x, py)
      context.lineTo(areaRect.x + areaRect.width, py)
      context.stroke()
    }
  }

  if (props.showSamplePoints) {
    for (let y = 0; y < props.outputHeight; y += 1) {
      for (let x = 0; x < props.outputWidth; x += 1) {
        const config = props.cellConfigs[y]?.[x]
        if (!config) {
          continue
        }
        const selected = isSelectedCell(x, y)
        if (config.algorithmId === 'anchor-point') {
          drawPoint(context, areaRect.x + (x + config.anchor.x) * cellWidth, areaRect.y + (y + config.anchor.y) * cellHeight, selected)
        } else if (config.algorithmId === 'multi-point-average' && selected) {
          for (const point of config.samplePoints) {
            drawPoint(context, areaRect.x + (x + point.x) * cellWidth, areaRect.y + (y + point.y) * cellHeight, true)
          }
        } else if (config.algorithmId === 'cell-average' && selected) {
          context.fillStyle = 'rgba(125, 211, 252, 0.12)'
          context.fillRect(areaRect.x + x * cellWidth, areaRect.y + y * cellHeight, cellWidth, cellHeight)
        }
      }
    }
  }

  if (props.selectedCell) {
    context.strokeStyle = '#7dd3fc'
    context.lineWidth = 2
    context.strokeRect(areaRect.x + props.selectedCell.x * cellWidth + 1, areaRect.y + props.selectedCell.y * cellHeight + 1, cellWidth - 2, cellHeight - 2)
  }
}

function resolveCanvasPosition(event: PointerEvent) {
  const canvas = canvasRef.value
  if (!canvas) {
    return null
  }
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height
  return { x, y }
}

function hitSamplingArea(event: PointerEvent) {
  const point = resolveCanvasPosition(event)
  if (!point || !props.sourceCanvas) {
    return null
  }
  const rect = getAreaRect(1)
  const threshold = 14 / zoom.value
  const insideX = point.x >= rect.x && point.x <= rect.x + rect.width
  const insideY = point.y >= rect.y && point.y <= rect.y + rect.height
  const nearLeft = Math.abs(point.x - rect.x) <= threshold && insideY
  const nearRight = Math.abs(point.x - (rect.x + rect.width)) <= threshold && insideY
  const nearTop = Math.abs(point.y - rect.y) <= threshold && insideX
  const nearBottom = Math.abs(point.y - (rect.y + rect.height)) <= threshold && insideX
  if (nearLeft || nearRight || nearTop || nearBottom) {
    return {
      action: 'resize' as const,
      handle: `${nearTop ? 'n' : nearBottom ? 's' : ''}${nearLeft ? 'w' : nearRight ? 'e' : ''}`,
    }
  }
  if (insideX && insideY) {
    return { action: 'move' as const, handle: '' }
  }
  return null
}

function updateHoverState(event: PointerEvent) {
  if (areaAction.value || panning.value) {
    return
  }
  const hit = hitSamplingArea(event)
  hoverAreaAction.value = hit?.action ?? null
  hoverAreaHandle.value = hit?.handle ?? ''
}

function updateAreaByPointer(event: PointerEvent) {
  if (!props.sourceCanvas || !areaAction.value) {
    return
  }
  const displayScale = getDisplayScale(props.sourceCanvas.width, props.sourceCanvas.height) * zoom.value
  const dx = (event.clientX - startPointerX.value) / displayScale
  const dy = (event.clientY - startPointerY.value) / displayScale
  let next = { ...startArea.value }

  if (areaAction.value === 'move') {
    next.x = startArea.value.x + dx
    next.y = startArea.value.y + dy
  } else if (!event.shiftKey) {
    const ratio = startArea.value.width / startArea.value.height
    let delta = Math.abs(dx) > Math.abs(dy) ? dx : dy * ratio
    if (areaHandle.value.includes('w')) {
      delta = -delta
      next.width = startArea.value.width + delta
      next.height = next.width / ratio
      next.x = startArea.value.x + startArea.value.width - next.width
      if (areaHandle.value.includes('n')) {
        next.y = startArea.value.y + startArea.value.height - next.height
      }
    } else {
      next.width = startArea.value.width + delta
      next.height = next.width / ratio
      if (areaHandle.value.includes('n')) {
        next.y = startArea.value.y + startArea.value.height - next.height
      }
    }
  } else {
    if (areaHandle.value.includes('w')) {
      next.x = startArea.value.x + dx
      next.width = startArea.value.width - dx
    }
    if (areaHandle.value.includes('e')) {
      next.width = startArea.value.width + dx
    }
    if (areaHandle.value.includes('n')) {
      next.y = startArea.value.y + dy
      next.height = startArea.value.height - dy
    }
    if (areaHandle.value.includes('s')) {
      next.height = startArea.value.height + dy
    }
  }

  next.width = Math.max(1, next.width)
  next.height = Math.max(1, next.height)
  next.x = clamp(next.x, 0, props.sourceCanvas.width - next.width)
  next.y = clamp(next.y, 0, props.sourceCanvas.height - next.height)
  emit('updateSamplingArea', next)
}

function resolveCell(event: PointerEvent) {
  const point = resolveCanvasPosition(event)
  const canvas = canvasRef.value
  if (!point || !canvas) {
    return null
  }
  const scale = canvas.width / (props.sourceCanvas?.width ?? canvas.width)
  const areaRect = getAreaRect(scale)
  if (point.x < areaRect.x || point.y < areaRect.y || point.x > areaRect.x + areaRect.width || point.y > areaRect.y + areaRect.height) {
    return null
  }
  const cellWidth = areaRect.width / props.outputWidth
  const cellHeight = areaRect.height / props.outputHeight
  const localX = point.x - areaRect.x
  const localY = point.y - areaRect.y
  const cellX = Math.min(props.outputWidth - 1, Math.max(0, Math.floor(localX / cellWidth)))
  const cellY = Math.min(props.outputHeight - 1, Math.max(0, Math.floor(localY / cellHeight)))
  const anchorX = Math.min(1, Math.max(0, (localX - cellX * cellWidth) / cellWidth))
  const anchorY = Math.min(1, Math.max(0, (localY - cellY * cellHeight) / cellHeight))
  return { cell: { x: cellX, y: cellY }, anchor: { x: anchorX, y: anchorY } }
}

function startPan(event: PointerEvent) {
  panning.value = true
  startPointerX.value = event.clientX
  startPointerY.value = event.clientY
  startPanX.value = panX.value
  startPanY.value = panY.value
  canvasRef.value?.setPointerCapture(event.pointerId)
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
}

function onPointerDown(event: PointerEvent) {
  const shouldPan = event.button === 1 || (spacePressed.value && event.button === 0)
  if (shouldPan) {
    event.preventDefault()
    startPan(event)
    return
  }

  const areaHit = hitSamplingArea(event)
  if (areaHit && event.button === 2) {
    event.preventDefault()
    areaAction.value = areaHit.action
    areaHandle.value = areaHit.handle
    startPointerX.value = event.clientX
    startPointerY.value = event.clientY
    startArea.value = { ...props.samplingArea }
    emit('samplingAreaChangeStart')
    canvasRef.value?.setPointerCapture(event.pointerId)
    return
  }

  const payload = resolveCell(event)
  if (!payload) {
    return
  }
  emit('select', payload.cell)
  const config = props.cellConfigs[payload.cell.y]?.[payload.cell.x]
  if (event.button === 0 && config?.algorithmId === 'anchor-point') {
    draggingCell.value = payload.cell
    emit('dragAnchorStart', payload.cell)
    emit('updateAnchor', payload)
    canvasRef.value?.setPointerCapture(event.pointerId)
  }
}

function onPointerMove(event: PointerEvent) {
  updateHoverState(event)

  if (areaAction.value) {
    updateAreaByPointer(event)
    return
  }

  if (panning.value) {
    panX.value = startPanX.value + (event.clientX - startPointerX.value)
    panY.value = startPanY.value + (event.clientY - startPointerY.value)
    return
  }

  if (draggingCell.value) {
    const payload = resolveCell(event)
    if (!payload) {
      return
    }
    emit('updateAnchor', {
      cell: draggingCell.value,
      anchor: payload.anchor,
    })
  }
}

function onDoubleClick(event: MouseEvent) {
  const payload = resolveCell(event as unknown as PointerEvent)
  if (!payload) {
    return
  }
  emit('select', payload.cell)
  emit('resetAnchor', payload.cell)
}

function endInteraction() {
  hoverAreaAction.value = null
  hoverAreaHandle.value = ''
  if (areaAction.value) {
    emit('samplingAreaChangeEnd')
  }
  areaAction.value = null
  areaHandle.value = ''
  if (draggingCell.value) {
    emit('dragAnchorEnd')
  }
  draggingCell.value = null
  panning.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.code === 'Space') {
    event.preventDefault()
    spacePressed.value = true
  }
}

function onKeyup(event: KeyboardEvent) {
  if (event.code === 'Space') {
    spacePressed.value = false
  }
}

watch(() => [
  props.renderKey,
  props.showGrid,
  props.showSamplePoints,
  props.outputWidth,
  props.outputHeight,
  props.selectedCell?.x,
  props.selectedCell?.y,
  props.samplingArea.x,
  props.samplingArea.y,
  props.samplingArea.width,
  props.samplingArea.height,
], draw)
watch(() => props.cellConfigs, draw)
onMounted(() => {
  draw()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('resize', draw)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('resize', draw)
})
</script>

<template>
  <section class="panel glass-panel stack-sm">
    <div class="panel-header compact">
      <div>
        <h2>像素点采样视图</h2>
        <p>拖动采样框移动区域，拖动边缘或角点调整大小；Space 或中键平移视图。</p>
      </div>
    </div>
    <div ref="viewportRef" class="canvas-shell pan-shell" @wheel.prevent="onWheel">
      <div class="canvas-stage" :style="stageStyle">
        <canvas
          ref="canvasRef"
          class="canvas-element"
          :style="canvasStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="endInteraction"
          @pointerleave="endInteraction"
          @pointercancel="endInteraction"
          @dblclick="onDoubleClick"
          @contextmenu.prevent
        />
      </div>
    </div>
  </section>
</template>
