<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ControlPanel from './components/ControlPanel.vue'
import ImageInputPanel from './components/ImageInputPanel.vue'
import ResultCanvas from './components/ResultCanvas.vue'
import SamplingCanvas from './components/SamplingCanvas.vue'
import SelectedSamplePreview from './components/SelectedSamplePreview.vue'
import { usePixelSampler } from './composables/usePixelSampler'
import type {
  AutoSamplingAlgorithmId,
  CellInfo,
  CellSampleConfig,
  SampleAlgorithmId,
  SampleAnchor,
  SamplePoint,
  SampleRegionInfo,
  SamplingArea,
  SelectedCell,
  SourceImageState,
} from './types'
import { copyCanvasImage, fileToImage, revokeImageUrl, saveCanvasImage } from './utils/image'

const MAX_UNDO_STEPS = 30

const sampler = usePixelSampler()
const source = ref<SourceImageState | null>(null)
const sourceUrl = ref<string | null>(null)
const outputWidth = ref(32)
const outputHeight = ref(32)
const keepAspectRatio = ref(true)
const previewScale = ref(12)
const selectedCell = ref<SelectedCell>(null)
const renderKey = ref(0)
const showGrid = ref(true)
const showSamplePoints = ref(true)
const focusViewsOnly = ref(false)
const selectedAutoAlgorithm = ref<AutoSamplingAlgorithmId>('feature-anchor')
const message = ref('')
const errorMessage = ref('')
const cellConfigs = ref<CellSampleConfig[][]>([])
const samplingArea = ref<SamplingArea>({ x: 0, y: 0, width: 1, height: 1 })
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const undoStack = ref<{ cellConfigs: CellSampleConfig[][]; samplingArea: SamplingArea }[]>([])
const isEditingSamplingArea = ref(false)
const manualColorPreviewCell = ref<SelectedCell>(null)
const manualColorPreviewHex = ref<string | null>(null)

let renderFrameId = 0
let scheduledFullSync = false

const canUndo = computed(() => undoStack.value.length > 0)

function normalizeHexColor(value: string) {
  const normalized = value.trim().replace('#', '')
  const hex = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }
  return `#${hex.toLowerCase()}`
}

function hexToRgba(value: string) {
  const normalized = normalizeHexColor(value)
  if (!normalized) {
    return null
  }
  const hex = normalized.slice(1)
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255] as [number, number, number, number]
}

function rgbaToColor(rgba: [number, number, number, number]) {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] / 255).toFixed(3)})`
}

const selectedConfig = computed(() => {
  renderKey.value
  if (!selectedCell.value) {
    return null
  }
  return cellConfigs.value[selectedCell.value.y]?.[selectedCell.value.x] ?? sampler.getCellConfig(selectedCell.value)
})

const selectedAlgorithm = computed<SampleAlgorithmId>(() => selectedConfig.value?.algorithmId ?? 'anchor-point')
const selectedSamplePoints = computed(() => selectedConfig.value?.samplePoints ?? [])

const selectedInfo = computed<CellInfo | null>(() => {
  renderKey.value
  if (!selectedCell.value) {
    return null
  }
  return sampler.sampleCell(selectedCell.value.x, selectedCell.value.y)
})

const selectedAnchor = computed(() => {
  renderKey.value
  if (!selectedCell.value) {
    return null
  }
  return selectedConfig.value?.anchor ?? sampler.getAnchor(selectedCell.value)
})

const displayedSelectedInfo = computed<CellInfo | null>(() => {
  const info = selectedInfo.value
  if (!info || !manualColorPreviewCell.value || !selectedCell.value || !manualColorPreviewHex.value) {
    return info
  }
  if (manualColorPreviewCell.value.x !== selectedCell.value.x || manualColorPreviewCell.value.y !== selectedCell.value.y) {
    return info
  }
  const rgba = hexToRgba(manualColorPreviewHex.value)
  const hex = normalizeHexColor(manualColorPreviewHex.value)
  if (!rgba || !hex) {
    return info
  }
  return {
    ...info,
    color: rgbaToColor(rgba),
    hex,
    rgba,
    isManualColor: true,
  }
})

const selectedSampleRegion = computed<SampleRegionInfo | null>(() => {
  renderKey.value
  return displayedSelectedInfo.value?.region ?? null
})

const displayCellInfos = computed(() => {
  renderKey.value
  return sampler.getRenderedCellInfos()
})

function clearStatus() {
  message.value = ''
  errorMessage.value = ''
}

function clearManualColorPreview() {
  manualColorPreviewCell.value = null
  manualColorPreviewHex.value = null
}

function renderInteractionFrame(syncConfigs = false) {
  if (!source.value) {
    resultCanvas.value = null
    cellConfigs.value = []
    renderKey.value += 1
    return
  }
  try {
    sampler.ensureGrid(outputWidth.value, outputHeight.value)
    resultCanvas.value = sampler.render(outputWidth.value, outputHeight.value)
    samplingArea.value = sampler.getSamplingArea()
    if (syncConfigs) {
      cellConfigs.value = sampler.cloneCellConfigs()
    }
    renderKey.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渲染失败'
  }
}

function syncRender() {
  renderInteractionFrame(true)
}

function scheduleRender(syncConfigs = false) {
  scheduledFullSync = scheduledFullSync || syncConfigs
  if (renderFrameId) {
    return
  }
  renderFrameId = window.requestAnimationFrame(() => {
    const shouldSyncConfigs = scheduledFullSync
    renderFrameId = 0
    scheduledFullSync = false
    renderInteractionFrame(shouldSyncConfigs)
  })
}

function pushUndoSnapshot() {
  const snapshot = sampler.cloneCellConfigs()
  if (!snapshot.length) {
    return
  }
  undoStack.value.push({ cellConfigs: snapshot, samplingArea: sampler.getSamplingArea() })
  if (undoStack.value.length > MAX_UNDO_STEPS) {
    undoStack.value.shift()
  }
}

function undoLastAction() {
  const snapshot = undoStack.value.pop()
  if (!snapshot) {
    return
  }
  clearStatus()
  sampler.replaceCellConfigs(snapshot.cellConfigs)
  sampler.setSamplingArea(snapshot.samplingArea)
  outputWidth.value = snapshot.cellConfigs[0]?.length ?? outputWidth.value
  outputHeight.value = snapshot.cellConfigs.length || outputHeight.value
  syncRender()
  message.value = '已撤回上一次采样配置修改。'
}

async function loadFile(file: File) {
  clearStatus()
  try {
    const loaded = await fileToImage(file)
    revokeImageUrl(sourceUrl.value)
    sourceUrl.value = loaded.url
    sampler.setImage(loaded.image)
    source.value = {
      width: loaded.image.naturalWidth,
      height: loaded.image.naturalHeight,
      name: file.name,
    }
    undoStack.value = []
    if (keepAspectRatio.value) {
      outputHeight.value = Math.max(1, Math.round((outputWidth.value / loaded.image.naturalWidth) * loaded.image.naturalHeight))
    }
    sampler.resizeGrid(outputWidth.value, outputHeight.value)
    selectedCell.value = { x: 0, y: 0 }
    syncRender()
    message.value = '图片已载入，可以开始逐格调整采样配置。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '图片载入失败'
  }
}

function setOutputWidth(value: number) {
  const next = Math.min(256, Math.max(1, Math.round(value || 1)))
  outputWidth.value = next
  if (keepAspectRatio.value && source.value) {
    outputHeight.value = Math.max(1, Math.round((next / source.value.width) * source.value.height))
  }
}

function setOutputHeight(value: number) {
  const next = Math.min(256, Math.max(1, Math.round(value || 1)))
  outputHeight.value = next
  if (keepAspectRatio.value && source.value) {
    outputWidth.value = Math.max(1, Math.round((next / source.value.height) * source.value.width))
  }
}

function commitSelectedAnchor(patch: Partial<SampleAnchor>, recordHistory = true) {
  const anchor = selectedAnchor.value
  if (!selectedCell.value || !anchor || selectedAlgorithm.value !== 'anchor-point') {
    return
  }
  if (recordHistory) {
    pushUndoSnapshot()
  }
  sampler.setAnchor(selectedCell.value, {
    x: patch.x ?? anchor.x,
    y: patch.y ?? anchor.y,
  })
  syncRender()
}

function previewSelectedAnchor(point: SampleAnchor) {
  if (!selectedCell.value || selectedAlgorithm.value !== 'anchor-point') {
    return
  }
  sampler.setAnchor(selectedCell.value, point)
  scheduleRender()
}

function resetSelectedAnchor() {
  if (!selectedCell.value || selectedAlgorithm.value !== 'anchor-point') {
    return
  }
  pushUndoSnapshot()
  sampler.resetAnchor(selectedCell.value)
  syncRender()
}

function resetSamplingByCell(cell: { x: number; y: number }) {
  selectedCell.value = cell
  pushUndoSnapshot()
  const algorithm = sampler.getCellAlgorithm(cell)
  if (algorithm === 'multi-point-average') {
    sampler.resetCellSamplePoints(cell)
  } else if (algorithm === 'cell-average') {
    sampler.resetCellConfig(cell)
  } else {
    sampler.resetAnchor(cell)
  }
  syncRender()
}

function resetSelectedCellSampling() {
  if (!selectedCell.value) {
    return
  }
  resetSamplingByCell(selectedCell.value)
}

function resetAllSampling() {
  pushUndoSnapshot()
  sampler.resetAllCellConfigs()
  syncRender()
  message.value = '所有采样配置已重置。'
}

function beginSamplingAreaChange() {
  if (isEditingSamplingArea.value) {
    return
  }
  pushUndoSnapshot()
  isEditingSamplingArea.value = true
}

function updateSamplingArea(area: SamplingArea) {
  if (!isEditingSamplingArea.value) {
    pushUndoSnapshot()
  }
  sampler.setSamplingArea(area)
  samplingArea.value = sampler.getSamplingArea()
  scheduleRender()
}

function endSamplingAreaChange() {
  isEditingSamplingArea.value = false
  syncRender()
}

function resetSamplingArea() {
  pushUndoSnapshot()
  sampler.resetSamplingArea()
  syncRender()
}

function setSelectedAlgorithm(algorithmId: SampleAlgorithmId) {
  if (!selectedCell.value || selectedAlgorithm.value === algorithmId) {
    return
  }
  pushUndoSnapshot()
  sampler.setCellAlgorithm(selectedCell.value, algorithmId)
  syncRender()
}

function autoSampleAllCells() {
  if (!source.value) {
    errorMessage.value = '请先导入图片。'
    return
  }
  clearStatus()
  pushUndoSnapshot()
  sampler.applyAutoSamplingToAllCells(selectedAutoAlgorithm.value)
  syncRender()
  message.value = '已按所选算法生成全部格采样配置，可继续逐格微调。'
}

function addSelectedSamplePointAt(point: SamplePoint) {
  if (!selectedCell.value || selectedAlgorithm.value !== 'multi-point-average') {
    return
  }
  pushUndoSnapshot()
  sampler.setCellSamplePoints(selectedCell.value, [...selectedSamplePoints.value, point])
  syncRender()
}

function previewSelectedManualColor(color: string) {
  if (!selectedCell.value) {
    return
  }
  const normalized = normalizeHexColor(color)
  manualColorPreviewCell.value = { ...selectedCell.value }
  manualColorPreviewHex.value = normalized
}

function commitSelectedManualColor(color: string) {
  if (!selectedCell.value) {
    return
  }
  pushUndoSnapshot()
  sampler.setCellManualColor(selectedCell.value, normalizeHexColor(color))
  clearManualColorPreview()
  syncRender()
}

function addSelectedSamplePoint() {
  addSelectedSamplePointAt({ x: 0.5, y: 0.5 })
}

function startSelectedSamplePointDrag() {
  if (!selectedCell.value || selectedAlgorithm.value === 'cell-average') {
    return
  }
  pushUndoSnapshot()
}

function onAnchorDragStart(cell: { x: number; y: number }) {
  selectedCell.value = cell
  pushUndoSnapshot()
}

function onAnchorDrag(payload: { cell: { x: number; y: number }; anchor: SampleAnchor }) {
  selectedCell.value = payload.cell
  sampler.setAnchor(payload.cell, payload.anchor)
  scheduleRender()
}

function onAnchorDragEnd() {
  syncRender()
}

function endSelectedManualColorPreview() {
  clearManualColorPreview()
}

function dragSelectedSamplePoint(payload: { index: number; point: SamplePoint }) {
  if (!selectedCell.value || selectedAlgorithm.value !== 'multi-point-average') {
    return
  }
  const next = selectedSamplePoints.value.map((point, index) => (index === payload.index ? payload.point : point))
  sampler.setCellSamplePoints(selectedCell.value, next)
  scheduleRender()
}

function endSelectedSamplePointDrag() {
  syncRender()
}

function updateSelectedSamplePoint(payload: { index: number; point: SamplePoint }) {
  if (!selectedCell.value || selectedAlgorithm.value !== 'multi-point-average') {
    return
  }
  const next = selectedSamplePoints.value.map((point, index) => (index === payload.index ? payload.point : point))
  pushUndoSnapshot()
  sampler.setCellSamplePoints(selectedCell.value, next)
  syncRender()
}

function removeSelectedSamplePoint(index: number) {
  if (!selectedCell.value || selectedAlgorithm.value !== 'multi-point-average') {
    return
  }
  const next = selectedSamplePoints.value.filter((_, pointIndex) => pointIndex !== index)
  pushUndoSnapshot()
  sampler.setCellSamplePoints(selectedCell.value, next)
  syncRender()
}

function resetSelectedSamplePoints() {
  if (!selectedCell.value || selectedAlgorithm.value !== 'multi-point-average') {
    return
  }
  pushUndoSnapshot()
  sampler.resetCellSamplePoints(selectedCell.value)
  syncRender()
}

async function copyResult() {
  if (!resultCanvas.value) {
    errorMessage.value = '请先导入图片。'
    return
  }
  clearStatus()
  try {
    await copyCanvasImage(resultCanvas.value)
    message.value = '结果图片已复制到剪贴板。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '复制失败'
  }
}

async function saveResult() {
  if (!resultCanvas.value) {
    errorMessage.value = '请先导入图片。'
    return
  }
  clearStatus()
  try {
    await saveCanvasImage(resultCanvas.value, `texture_${outputWidth.value}x${outputHeight.value}.png`)
    message.value = 'PNG 已保存。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败'
  }
}

function handlePaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
  if (!file) {
    return
  }
  event.preventDefault()
  void loadFile(file)
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const isFormField = !!target?.closest('input, textarea, select')

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !isFormField) {
    event.preventDefault()
    undoLastAction()
    return
  }

  if (!selectedCell.value || isFormField || selectedAlgorithm.value !== 'anchor-point') {
    return
  }

  const step = event.shiftKey ? 0.01 : 0.05
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    commitSelectedAnchor({ x: (selectedAnchor.value?.x ?? 0.5) - step })
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    commitSelectedAnchor({ x: (selectedAnchor.value?.x ?? 0.5) + step })
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    commitSelectedAnchor({ y: (selectedAnchor.value?.y ?? 0.5) - step })
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    commitSelectedAnchor({ y: (selectedAnchor.value?.y ?? 0.5) + step })
  }
}

watch([outputWidth, outputHeight], () => {
  if (source.value) {
    syncRender()
  }
})

onMounted(() => {
  window.addEventListener('paste', handlePaste)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste)
  window.removeEventListener('keydown', onKeydown)
  revokeImageUrl(sourceUrl.value)
  if (renderFrameId) {
    window.cancelAnimationFrame(renderFrameId)
  }
})
</script>

<template>
  <main class="app-layout" :class="{ 'views-only-mode': focusViewsOnly }">
    <div class="app-background" aria-hidden="true">
      <span class="glow glow-one"></span>
      <span class="glow glow-two"></span>
      <span class="glow glow-three"></span>
      <span class="glow glow-four"></span>
      <span class="ambient-grid"></span>
    </div>

    <button type="button" class="floating-view-toggle secondary-button" @click="focusViewsOnly = !focusViewsOnly">
      {{ focusViewsOnly ? '显示全部面板' : '只显示三个视图' }}
    </button>

    <Transition name="hero-fade">
      <header v-if="!focusViewsOnly" class="hero panel glass-panel">
        <div>
          <p class="eyebrow">Pixel Texture Tool</p>
          <h1>AI 像素贴图降分辨率工具</h1>
          <p class="hero-copy">导入图片后，按目标分辨率逐格控制采样算法，实时观察采样视图、局部视图与结果预览。</p>
        </div>
      </header>
    </Transition>

    <section class="workspace-grid">
      <Transition name="panel-stack-fade">
        <div v-if="!focusViewsOnly" class="left-column stack-lg">
          <ImageInputPanel @file="loadFile" />
          <ControlPanel
            :source="source"
            :output-width="outputWidth"
            :output-height="outputHeight"
            :keep-aspect-ratio="keepAspectRatio"
            :preview-scale="previewScale"
            :selected-cell="selectedCell"
            :selected-anchor="selectedAnchor"
            :selected-info="displayedSelectedInfo"
            :selected-algorithm="selectedAlgorithm"
            :auto-algorithm="selectedAutoAlgorithm"
            :selected-sample-points="selectedSamplePoints"
            :selected-sample-region="selectedSampleRegion"
            :sampling-area="samplingArea"
            :show-grid="showGrid"
            :show-sample-points="showSamplePoints"
            :message="message"
            :error-message="errorMessage"
            :can-undo="canUndo"
            @set-output-width="setOutputWidth"
            @set-output-height="setOutputHeight"
            @set-keep-aspect-ratio="keepAspectRatio = $event"
            @set-preview-scale="previewScale = Math.min(32, Math.max(4, Math.round($event || 4)))"
            @set-show-grid="showGrid = $event"
            @set-show-sample-points="showSamplePoints = $event"
            @set-selected-anchor-x="commitSelectedAnchor({ x: $event })"
            @set-selected-anchor-y="commitSelectedAnchor({ y: $event })"
            @set-selected-algorithm="setSelectedAlgorithm"
            @set-auto-algorithm="selectedAutoAlgorithm = $event"
            @auto-sample-all-cells="autoSampleAllCells"
            @update-sampling-area="updateSamplingArea"
            @reset-sampling-area="resetSamplingArea"
            @add-selected-sample-point="addSelectedSamplePoint"
            @update-selected-sample-point="updateSelectedSamplePoint"
            @remove-selected-sample-point="removeSelectedSamplePoint"
            @reset-selected-sample-points="resetSelectedSamplePoints"
            @reset-selected-cell-sampling="resetSelectedCellSampling"
            @reset-selected-anchor="resetSelectedAnchor"
            @reset-all-anchors="resetAllSampling"
            @copy-result="copyResult"
            @save-result="saveResult"
            @undo="undoLastAction"
          />
        </div>
      </Transition>

      <div class="right-column stack-lg animated-stack">
        <SamplingCanvas
          :source-canvas="source ? sampler.getSourceCanvas() : null"
          :cell-configs="cellConfigs"
          :display-cell-infos="displayCellInfos"
          :output-width="outputWidth"
          :output-height="outputHeight"
          :selected-cell="selectedCell"
          :sampling-area="samplingArea"
          :show-grid="showGrid"
          :show-sample-points="showSamplePoints"
          :render-key="renderKey"
          @select="selectedCell = $event"
          @drag-anchor-start="onAnchorDragStart"
          @update-anchor="onAnchorDrag"
          @drag-anchor-end="onAnchorDragEnd"
          @reset-anchor="resetSamplingByCell"
          @sampling-area-change-start="beginSamplingAreaChange"
          @update-sampling-area="updateSamplingArea"
          @sampling-area-change-end="endSamplingAreaChange"
        />
        <div class="preview-row">
          <SelectedSamplePreview
            :source-canvas="source ? sampler.getSourceCanvas() : null"
            :selected-cell="selectedCell"
            :selected-info="displayedSelectedInfo"
            :selected-anchor="selectedAnchor"
            :selected-sample-region="selectedSampleRegion"
            :selected-algorithm="selectedAlgorithm"
            :selected-sample-points="selectedSamplePoints"
            :render-key="renderKey"
            @add-sample-point="addSelectedSamplePointAt"
            @start-point-drag="startSelectedSamplePointDrag"
            @update-anchor-point="previewSelectedAnchor"
            @preview-manual-color="previewSelectedManualColor"
            @commit-manual-color="commitSelectedManualColor"
            @end-manual-color-preview="endSelectedManualColorPreview"
            @update-sample-point="dragSelectedSamplePoint"
            @end-point-drag="endSelectedSamplePointDrag"
          />
          <ResultCanvas
            :result-canvas="resultCanvas"
            :output-width="outputWidth"
            :output-height="outputHeight"
            :preview-scale="previewScale"
            :selected-cell="selectedCell"
            :render-key="renderKey"
          />
        </div>
      </div>
    </section>
  </main>
</template>
