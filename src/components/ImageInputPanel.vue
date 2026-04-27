<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  file: [file: File]
}>()

const dragActive = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

function acceptFile(file: File | null | undefined) {
  if (!file) {
    return
  }
  if (!file.type.startsWith('image/')) {
    return
  }
  emit('file', file)
}

function onChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  acceptFile(file)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  dragActive.value = false
  acceptFile(event.dataTransfer?.files?.[0])
}

function onPaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
  acceptFile(file)
}
</script>

<template>
  <section class="panel glass-panel stack-md">
    <div class="panel-header">
      <div>
        <h2>导入图片</h2>
        <p>支持拖拽、点击选择和直接粘贴截图。</p>
      </div>
      <button type="button" class="secondary-button" @click="inputRef?.click()">打开图片</button>
    </div>

    <div
      class="drop-zone"
      :class="{ active: dragActive }"
      tabindex="0"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop="onDrop"
      @paste="onPaste"
    >
      <input ref="inputRef" class="hidden-input" type="file" name="source-image" accept="image/*" @change="onChange" />
      <strong>拖拽图片到这里</strong>
      <span>或点击“打开图片”，也可以先聚焦这里后直接 Ctrl+V 粘贴图片。</span>
    </div>
  </section>
</template>
