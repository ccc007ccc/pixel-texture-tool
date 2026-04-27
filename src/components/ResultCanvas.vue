<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'

import type { SelectedCell } from '../types'

const props = defineProps({
  resultCanvas: {
    type: Object as PropType<HTMLCanvasElement | null>,
    default: null,
  },
  outputWidth: {
    type: Number,
    required: true,
  },
  outputHeight: {
    type: Number,
    required: true,
  },
  previewScale: {
    type: Number,
    required: true,
  },
  selectedCell: {
    type: Object as PropType<SelectedCell>,
    default: null,
  },
  renderKey: {
    type: Number,
    required: true,
  },
})

const shellRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const panning = ref(false)
const panX = ref(0)
const panY = ref(0)
const zoom = ref(1)
const startPointerX = ref(0)
const startPointerY = ref(0)
const startPanX = ref(0)
const startPanY = ref(0)

const MIN_ZOOM = 0.5
const MAX_ZOOM = 24

const stageStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  cursor: panning.value ? 'grabbing' : 'grab',
}))

function draw() {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  if (!props.resultCanvas) {
    canvas.width = 420
    canvas.height = 420
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#0c1324'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(223, 233, 252, 0.75)'
    context.font = '16px sans-serif'
    context.textAlign = 'center'
    context.fillText('结果预览会显示在这里', canvas.width / 2, canvas.height / 2)
    return
  }

  const scale = props.previewScale
  canvas.width = props.outputWidth * scale
  canvas.height = props.outputHeight * scale
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  context.drawImage(props.resultCanvas, 0, 0, canvas.width, canvas.height)

  if (props.selectedCell) {
    context.strokeStyle = '#7dd3fc'
    context.lineWidth = 2
    context.strokeRect(props.selectedCell.x * scale + 1, props.selectedCell.y * scale + 1, scale - 2, scale - 2)
  }
}

function onPointerDown(event: PointerEvent) {
  panning.value = true
  startPointerX.value = event.clientX
  startPointerY.value = event.clientY
  startPanX.value = panX.value
  startPanY.value = panY.value
  canvasRef.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!panning.value) {
    return
  }
  panX.value = startPanX.value + (event.clientX - startPointerX.value)
  panY.value = startPanY.value + (event.clientY - startPointerY.value)
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

function endPan() {
  panning.value = false
}

watch(() => [
  props.renderKey,
  props.outputWidth,
  props.outputHeight,
  props.previewScale,
  props.selectedCell?.x,
  props.selectedCell?.y,
  props.resultCanvas,
], draw)
onMounted(draw)
</script>

<template>
  <section class="panel glass-panel stack-sm">
    <div class="panel-header compact">
      <div>
        <h2>结果预览</h2>
        <p>拖动画布平移查看，保持原生直角像素边缘。</p>
      </div>
    </div>
    <div ref="shellRef" class="canvas-shell result-shell pan-shell" @wheel.prevent="onWheel">
      <div class="canvas-stage" :style="stageStyle">
        <canvas
          ref="canvasRef"
          class="canvas-element result-canvas"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="endPan"
          @pointerleave="endPan"
          @pointercancel="endPan"
        />
      </div>
    </div>
  </section>
</template>
