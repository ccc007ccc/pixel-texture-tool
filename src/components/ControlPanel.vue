<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  CellInfo,
  SampleAlgorithmId,
  SampleAnchor,
  SamplePoint,
  SampleRegionInfo,
  SamplingArea,
  SelectedCell,
  SourceImageState,
} from '../types'

const props = defineProps<{
  source: SourceImageState | null
  outputWidth: number
  outputHeight: number
  keepAspectRatio: boolean
  previewScale: number
  selectedCell: SelectedCell
  selectedAnchor: SampleAnchor | null
  selectedInfo: CellInfo | null
  selectedAlgorithm: SampleAlgorithmId
  selectedSamplePoints: SamplePoint[]
  selectedSampleRegion: SampleRegionInfo | null
  samplingArea: SamplingArea
  showGrid: boolean
  showSamplePoints: boolean
  message: string
  errorMessage: string
  canUndo: boolean
}>()

const emit = defineEmits<{
  setOutputWidth: [value: number]
  setOutputHeight: [value: number]
  setKeepAspectRatio: [value: boolean]
  setPreviewScale: [value: number]
  setShowGrid: [value: boolean]
  setShowSamplePoints: [value: boolean]
  setSelectedAnchorX: [value: number]
  setSelectedAnchorY: [value: number]
  setSelectedAlgorithm: [value: SampleAlgorithmId]
  updateSamplingArea: [value: SamplingArea]
  resetSamplingArea: []
  addSelectedSamplePoint: []
  updateSelectedSamplePoint: [payload: { index: number; point: SamplePoint }]
  removeSelectedSamplePoint: [index: number]
  resetSelectedSamplePoints: []
  resetSelectedCellSampling: []
  resetSelectedAnchor: []
  resetAllAnchors: []
  copyResult: []
  saveResult: []
  undo: []
}>()

const outputOpen = ref(true)
const areaOpen = ref(true)
const samplingOpen = ref(true)
const statusOpen = ref(false)

const sectionMeta = computed(() => ({
  output: {
    label: '基础输出设置',
    open: outputOpen.value,
  },
  area: {
    label: `采样区域 · ${samplingAreaLabel.value}`,
    open: areaOpen.value,
  },
  sampling: {
    label: `当前格采样配置 · ${props.selectedCell ? algorithmLabels[props.selectedAlgorithm] : '未选中'}`,
    open: samplingOpen.value,
  },
  status: {
    label: '提示与状态',
    open: statusOpen.value,
  },
}))

const samplingAreaLabel = computed(() => `${props.samplingArea.x},${props.samplingArea.y} / ${props.samplingArea.width}×${props.samplingArea.height}`)

function sectionToggleLabel(open: boolean) {
  return open ? '收起' : '展开'
}

const algorithmLabels: Record<SampleAlgorithmId, string> = {
  'anchor-point': '单点采样',
  'multi-point-average': '多点平均',
  'cell-average': '整格平均',
}

function updateArea(patch: Partial<SamplingArea>) {
  emit('updateSamplingArea', {
    x: patch.x ?? props.samplingArea.x,
    y: patch.y ?? props.samplingArea.y,
    width: patch.width ?? props.samplingArea.width,
    height: patch.height ?? props.samplingArea.height,
  })
}

function updatePoint(index: number, patch: Partial<SamplePoint>) {
  const current = props.selectedSamplePoints[index]
  if (!current) {
    return
  }
  emit('updateSelectedSamplePoint', {
    index,
    point: {
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
    },
  })
}
</script>

<template>
  <section class="panel glass-panel stack-md compact-control-panel">
    <div class="panel-header">
      <div>
        <h2>项目设置</h2>
        <p>参数、采样算法与导出操作可分区收起。</p>
      </div>
      <div class="button-row wrap">
        <button type="button" class="secondary-button" :disabled="!canUndo" @click="emit('undo')">撤回</button>
        <button type="button" class="primary-button" @click="emit('copyResult')">复制</button>
        <button type="button" class="primary-button alt" @click="emit('saveResult')">保存</button>
      </div>
    </div>

    <div class="control-section">
      <button type="button" class="section-toggle" :aria-expanded="outputOpen" @click="outputOpen = !outputOpen">
        <span>{{ sectionMeta.output.label }}</span>
        <span class="section-toggle-state">{{ sectionToggleLabel(sectionMeta.output.open) }}</span>
      </button>
      <Transition name="section-collapse">
        <div v-if="outputOpen" class="section-body form-grid two-columns">
          <label>
            输出宽度
            <input name="output-width" :value="outputWidth" type="number" min="1" max="256" @input="emit('setOutputWidth', Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label>
            输出高度
            <input name="output-height" :value="outputHeight" type="number" min="1" max="256" @input="emit('setOutputHeight', Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label class="checkbox-field full-span">
            <input name="keep-aspect-ratio" :checked="keepAspectRatio" type="checkbox" @change="emit('setKeepAspectRatio', ($event.target as HTMLInputElement).checked)" />
            <span>锁定原图比例</span>
          </label>
          <label>
            结果放大倍数
            <input name="preview-scale" :value="previewScale" type="number" min="4" max="32" @input="emit('setPreviewScale', Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label>
            当前格采样算法
            <select name="selected-algorithm" :value="selectedAlgorithm" :disabled="!selectedCell" @change="emit('setSelectedAlgorithm', ($event.target as HTMLSelectElement).value as SampleAlgorithmId)">
              <option value="anchor-point">单点采样</option>
              <option value="multi-point-average">多点平均</option>
              <option value="cell-average">整格平均</option>
            </select>
          </label>
          <label class="checkbox-field">
            <input name="show-grid" :checked="showGrid" type="checkbox" @change="emit('setShowGrid', ($event.target as HTMLInputElement).checked)" />
            <span>显示采样网格</span>
          </label>
          <label class="checkbox-field">
            <input name="show-sample-points" :checked="showSamplePoints" type="checkbox" @change="emit('setShowSamplePoints', ($event.target as HTMLInputElement).checked)" />
            <span>显示采样点</span>
          </label>
        </div>
      </Transition>
    </div>

    <div class="control-section">
      <button type="button" class="section-toggle" :aria-expanded="areaOpen" @click="areaOpen = !areaOpen">
        <span>{{ sectionMeta.area.label }}</span>
        <span class="section-toggle-state">{{ sectionToggleLabel(sectionMeta.area.open) }}</span>
      </button>
      <Transition name="section-collapse">
        <div v-if="areaOpen" class="section-body form-grid two-columns">
          <label>
            区域 X
            <input name="sampling-area-x" :value="samplingArea.x" :disabled="!source" type="number" min="0" @change="updateArea({ x: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label>
            区域 Y
            <input name="sampling-area-y" :value="samplingArea.y" :disabled="!source" type="number" min="0" @change="updateArea({ y: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label>
            区域宽度
            <input name="sampling-area-width" :value="samplingArea.width" :disabled="!source" type="number" min="1" @change="updateArea({ width: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label>
            区域高度
            <input name="sampling-area-height" :value="samplingArea.height" :disabled="!source" type="number" min="1" @change="updateArea({ height: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <button type="button" class="secondary-button full-span" :disabled="!source" @click="emit('resetSamplingArea')">重置为整图</button>
        </div>
      </Transition>
    </div>

    <div class="info-grid compact-info-grid">
      <div class="info-card">
        <span>原图</span>
        <strong>{{ source ? `${source.name} · ${source.width} × ${source.height}` : '未载入图片' }}</strong>
      </div>
      <div class="info-card">
        <span>当前像素</span>
        <strong>{{ selectedCell ? `(${selectedCell.x}, ${selectedCell.y})` : '未选中' }}</strong>
      </div>
      <div class="info-card">
        <span>当前颜色</span>
        <strong>{{ selectedInfo?.color ?? '未选中' }}</strong>
      </div>
    </div>

    <div class="control-section">
      <button type="button" class="section-toggle" :aria-expanded="samplingOpen" @click="samplingOpen = !samplingOpen">
        <span>{{ sectionMeta.sampling.label }}</span>
        <span class="section-toggle-state">{{ sectionToggleLabel(sectionMeta.sampling.open) }}</span>
      </button>
      <Transition name="section-collapse">
        <div v-if="samplingOpen" class="section-body subpanel stack-sm compact-subpanel">
          <div class="panel-header compact">
            <div>
              <h3>当前像素采样配置</h3>
              <p>{{ selectedAlgorithm === 'multi-point-average' ? '可在右侧选中采样区域右键新增采样点，也可在这里精确编辑。' : selectedCell ? algorithmLabels[selectedAlgorithm] : '选中一个像素后可编辑采样配置。' }}</p>
            </div>
            <button type="button" class="secondary-button" :disabled="!selectedCell" @click="emit('resetSelectedCellSampling')">重置当前格</button>
          </div>

          <div v-if="selectedAlgorithm === 'anchor-point'" class="form-grid two-columns">
            <label>
              Anchor X
              <input name="selected-anchor-x" :value="selectedAnchor?.x ?? 0.5" :disabled="!selectedCell" type="number" min="0" max="1" step="0.01" @change="emit('setSelectedAnchorX', Number(($event.target as HTMLInputElement).value))" />
            </label>
            <label>
              Anchor Y
              <input name="selected-anchor-y" :value="selectedAnchor?.y ?? 0.5" :disabled="!selectedCell" type="number" min="0" max="1" step="0.01" @change="emit('setSelectedAnchorY', Number(($event.target as HTMLInputElement).value))" />
            </label>
          </div>

          <div v-else-if="selectedAlgorithm === 'multi-point-average'" class="stack-sm">
            <div class="sample-point-toolbar">
              <span>当前格采样点：{{ selectedSamplePoints.length }}</span>
              <div class="button-row wrap">
                <button type="button" class="secondary-button" :disabled="!selectedCell" @click="emit('addSelectedSamplePoint')">中心点</button>
                <button type="button" class="secondary-button" :disabled="!selectedCell" @click="emit('resetSelectedSamplePoints')">默认点</button>
              </div>
            </div>
            <div class="sample-point-list compact-point-list">
              <div v-for="(point, index) in selectedSamplePoints" :key="index" class="sample-point-row">
                <span>#{{ index + 1 }}</span>
                <label>
                  X
                  <input :name="`sample-point-x-${index}`" :value="point.x" type="number" min="0" max="1" step="0.01" @change="updatePoint(index, { x: Number(($event.target as HTMLInputElement).value) })" />
                </label>
                <label>
                  Y
                  <input :name="`sample-point-y-${index}`" :value="point.y" type="number" min="0" max="1" step="0.01" @change="updatePoint(index, { y: Number(($event.target as HTMLInputElement).value) })" />
                </label>
                <button type="button" class="secondary-button compact-button" @click="emit('removeSelectedSamplePoint', index)">删</button>
              </div>
            </div>
          </div>

          <div v-else class="shortcut-hint">整格平均会使用当前输出像素覆盖的整块原图区域，Anchor 与自定义点不会参与计算。</div>

          <div class="info-grid single-column">
            <div class="info-card">
              <span>采样坐标 / 区域</span>
              <strong v-if="selectedInfo && selectedSampleRegion">
                {{ `${selectedInfo.displaySampleX.toFixed(2)}, ${selectedInfo.displaySampleY.toFixed(2)} · ${selectedSampleRegion.startX},${selectedSampleRegion.startY} → ${selectedSampleRegion.endX},${selectedSampleRegion.endY}` }}
              </strong>
              <strong v-else>未选中</strong>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <div class="control-section">
      <button type="button" class="section-toggle" :aria-expanded="statusOpen" @click="statusOpen = !statusOpen">
        <span>{{ sectionMeta.status.label }}</span>
        <span class="section-toggle-state">{{ sectionToggleLabel(sectionMeta.status.open) }}</span>
      </button>
      <Transition name="section-collapse">
        <div v-if="statusOpen" class="section-body stack-sm">
          <div class="shortcut-hint">快捷键：Ctrl/Cmd + Z 撤回；采样视图可双击重置当前格采样配置。</div>
          <div class="view-hints">
            <span>采样视图：单点模式可左键拖点；Space + 拖动 / 中键拖动可平移。</span>
            <span>多点模式：右侧“选中采样区域”可右键新增采样点。</span>
          </div>
        </div>
      </Transition>
    </div>

    <div class="button-row wrap">
      <button type="button" class="secondary-button" @click="emit('resetAllAnchors')">重置全部采样配置</button>
    </div>

    <div v-if="message" class="status-banner success">{{ message }}</div>
    <div v-if="errorMessage" class="status-banner error">{{ errorMessage }}</div>
  </section>
</template>
