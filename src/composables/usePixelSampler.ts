import type {
  AutoCellResolution,
  AutoSamplingAlgorithmId,
  CellInfo,
  CellSampleConfig,
  SampleAlgorithmId,
  SampleAnchor,
  SamplePoint,
  SampleRegionInfo,
  SamplingArea,
  SelectedCell,
} from '../types'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createDefaultSamplePoints(): SamplePoint[] {
  return [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.75 },
    { x: 0.75, y: 0.75 },
  ]
}

function clonePoints(points: SamplePoint[]) {
  return points.map((point) => ({ ...point }))
}

function createCellConfig(): CellSampleConfig {
  return {
    algorithmId: 'anchor-point',
    anchor: { x: 0.5, y: 0.5 },
    samplePoints: createDefaultSamplePoints(),
    manualColor: null,
  }
}

function createCellConfigGrid(width: number, height: number) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => createCellConfig()))
}

function createAutoResolutionGrid(width: number, height: number) {
  return Array.from({ length: height }, () => Array.from<AutoCellResolution | null>({ length: width }).fill(null))
}

function createRenderedCellInfoGrid(width: number, height: number) {
  return Array.from({ length: height }, () => Array.from<CellInfo | null>({ length: width }).fill(null))
}

function cloneCellConfigGrid(configs: CellSampleConfig[][]) {
  return configs.map((row) =>
    row.map((config) => ({
      algorithmId: config.algorithmId,
      anchor: { ...config.anchor },
      samplePoints: clonePoints(config.samplePoints),
      manualColor: config.manualColor,
    })),
  )
}

function cloneRenderedCellInfoGrid(configs: (CellInfo | null)[][]) {
  return configs.map((row) => row.slice())
}

function rgbaToColor(rgba: [number, number, number, number]) {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] / 255).toFixed(3)})`
}

function rgbaToHex(rgba: [number, number, number, number]) {
  return `#${rgba[0].toString(16).padStart(2, '0')}${rgba[1].toString(16).padStart(2, '0')}${rgba[2].toString(16).padStart(2, '0')}`
}

function hexToRgba(color: string) {
  const normalized = color.trim().replace('#', '')
  const hex = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255] as [number, number, number, number]
}

function averageRgba(values: [number, number, number, number][]) {
  if (!values.length) {
    return [0, 0, 0, 0] as [number, number, number, number]
  }
  const sum = values.reduce(
    (acc, rgba) => {
      acc[0] += rgba[0]
      acc[1] += rgba[1]
      acc[2] += rgba[2]
      acc[3] += rgba[3]
      return acc
    },
    [0, 0, 0, 0],
  )
  return sum.map((value) => Math.round(value / values.length)) as [number, number, number, number]
}

export function usePixelSampler() {
  const sourceCanvas = document.createElement('canvas')
  const sourceCtxMaybe = sourceCanvas.getContext('2d', { willReadFrequently: true })
  const resultCanvas = document.createElement('canvas')
  const resultCtxMaybe = resultCanvas.getContext('2d', { willReadFrequently: true })

  if (!sourceCtxMaybe || !resultCtxMaybe) {
    throw new Error('浏览器不支持 Canvas 2D')
  }

  const sourceCtx: CanvasRenderingContext2D = sourceCtxMaybe
  const resultCtx: CanvasRenderingContext2D = resultCtxMaybe

  let sourceImageData: ImageData | null = null
  let cellConfigs: CellSampleConfig[][] = []
  let samplingArea: SamplingArea = { x: 0, y: 0, width: 1, height: 1 }
  let outputWidth = 32
  let outputHeight = 32
  let autoAnchorCache: (AutoCellResolution | null)[][] = []
  let autoCacheDirty = true
  let renderedCellInfos: (CellInfo | null)[][] = []

  function markAutoCacheDirty() {
    autoCacheDirty = true
  }

  function clampSamplingArea(area: SamplingArea): SamplingArea {
    const width = Math.max(1, Math.min(Math.round(area.width || 1), sourceCanvas.width || 1))
    const height = Math.max(1, Math.min(Math.round(area.height || 1), sourceCanvas.height || 1))
    return {
      x: Math.max(0, Math.min(Math.round(area.x || 0), Math.max(0, sourceCanvas.width - width))),
      y: Math.max(0, Math.min(Math.round(area.y || 0), Math.max(0, sourceCanvas.height - height))),
      width,
      height,
    }
  }

  function setSamplingArea(area: SamplingArea) {
    samplingArea = clampSamplingArea(area)
    markAutoCacheDirty()
  }

  function resetSamplingArea() {
    samplingArea = { x: 0, y: 0, width: Math.max(1, sourceCanvas.width), height: Math.max(1, sourceCanvas.height) }
    markAutoCacheDirty()
  }

  function setImage(image: HTMLImageElement) {
    sourceCanvas.width = image.naturalWidth
    sourceCanvas.height = image.naturalHeight
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height)
    sourceCtx.drawImage(image, 0, 0)
    sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
    resetSamplingArea()
    markAutoCacheDirty()
  }

  function resizeGrid(width: number, height: number) {
    const next = createCellConfigGrid(width, height)
    const copyHeight = Math.min(height, cellConfigs.length)
    const copyWidth = Math.min(width, cellConfigs[0]?.length ?? 0)

    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        next[y][x] = {
          algorithmId: cellConfigs[y][x].algorithmId,
          anchor: { ...cellConfigs[y][x].anchor },
          samplePoints: clonePoints(cellConfigs[y][x].samplePoints),
          manualColor: cellConfigs[y][x].manualColor,
        }
      }
    }

    cellConfigs = next
    outputWidth = width
    outputHeight = height
    markAutoCacheDirty()
  }

  function ensureGrid(width: number, height: number) {
    if (!cellConfigs.length || outputWidth !== width || outputHeight !== height) {
      resizeGrid(width, height)
    }
  }

  function getCellConfig(cell: SelectedCell) {
    if (!cell) {
      return null
    }
    return cellConfigs[cell.y]?.[cell.x] ?? null
  }

  function resetAnchors(fill: SampleAnchor = { x: 0.5, y: 0.5 }) {
    for (const row of cellConfigs) {
      for (const config of row) {
        config.anchor = { ...fill }
      }
    }
  }

  function resetAnchor(cell: SelectedCell) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.anchor = { x: 0.5, y: 0.5 }
    config.manualColor = null
  }

  function setAnchor(cell: SelectedCell, anchor: SampleAnchor) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.anchor = {
      x: clamp(anchor.x, 0, 1),
      y: clamp(anchor.y, 0, 1),
    }
    config.manualColor = null
  }

  function getAnchor(cell: SelectedCell) {
    return getCellConfig(cell)?.anchor ?? null
  }

  function setCellAlgorithm(cell: SelectedCell, algorithmId: SampleAlgorithmId) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.algorithmId = algorithmId
    config.manualColor = null
  }

  function getCellAlgorithm(cell: SelectedCell) {
    return getCellConfig(cell)?.algorithmId ?? null
  }

  function normalizePoint(point: SamplePoint) {
    return {
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1),
    }
  }

  function setCellSamplePoints(cell: SelectedCell, points: SamplePoint[]) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.samplePoints = points.map(normalizePoint)
    config.manualColor = null
  }

  function setCellManualColor(cell: SelectedCell, color: string | null) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.manualColor = color
  }

  function getCellSamplePoints(cell: SelectedCell) {
    const config = getCellConfig(cell)
    return config ? clonePoints(config.samplePoints) : []
  }

  function resetCellSamplePoints(cell: SelectedCell) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.samplePoints = createDefaultSamplePoints()
  }

  function resetCellConfig(cell: SelectedCell) {
    const config = getCellConfig(cell)
    if (!config) {
      return
    }
    config.algorithmId = 'anchor-point'
    config.anchor = { x: 0.5, y: 0.5 }
    config.samplePoints = createDefaultSamplePoints()
    config.manualColor = null
  }

  function resetAllCellConfigs() {
    for (const row of cellConfigs) {
      for (let index = 0; index < row.length; index += 1) {
        row[index] = createCellConfig()
      }
    }
  }

  function replaceCellConfigs(nextConfigs: CellSampleConfig[][]) {
    cellConfigs = cloneCellConfigGrid(nextConfigs)
    outputHeight = cellConfigs.length
    outputWidth = cellConfigs[0]?.length ?? 0
    markAutoCacheDirty()
  }

  function readPixel(pixelX: number, pixelY: number) {
    if (!sourceImageData) {
      return [0, 0, 0, 0] as [number, number, number, number]
    }
    const x = clamp(Math.round(pixelX), 0, sourceCanvas.width - 1)
    const y = clamp(Math.round(pixelY), 0, sourceCanvas.height - 1)
    const index = (y * sourceCanvas.width + x) * 4
    const { data } = sourceImageData
    return [data[index], data[index + 1], data[index + 2], data[index + 3]] as [number, number, number, number]
  }

  function resolveCellBounds(cellX: number, cellY: number) {
    const area = clampSamplingArea(samplingArea)
    const cellWidth = area.width / outputWidth
    const cellHeight = area.height / outputHeight
    const startX = clamp(Math.floor(area.x + cellX * cellWidth), area.x, area.x + area.width - 1)
    const startY = clamp(Math.floor(area.y + cellY * cellHeight), area.y, area.y + area.height - 1)
    const endX = clamp(Math.ceil(area.x + (cellX + 1) * cellWidth) - 1, startX, area.x + area.width - 1)
    const endY = clamp(Math.ceil(area.y + (cellY + 1) * cellHeight) - 1, startY, area.y + area.height - 1)
    return { startX, startY, endX, endY, cellWidth, cellHeight, area }
  }

  function mapPointToSource(cellX: number, cellY: number, point: SamplePoint) {
    const { startX, startY, endX, endY } = resolveCellBounds(cellX, cellY)
    const regionWidth = endX - startX + 1
    const regionHeight = endY - startY + 1
    return {
      x: clamp(startX + point.x * regionWidth - 0.5, startX, endX),
      y: clamp(startY + point.y * regionHeight - 0.5, startY, endY),
    }
  }

  function buildSampleRegionInfo(cellX: number, cellY: number, algorithmId: SampleAlgorithmId, samplePoints: SamplePoint[]): SampleRegionInfo {
    const { startX, startY, endX, endY } = resolveCellBounds(cellX, cellY)
    return {
      startX,
      startY,
      endX,
      endY,
      samplePoints,
      algorithmId,
    }
  }

  function getAutoAnchorCandidates(): SampleAnchor[] {
    return [
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
      { x: 0.2, y: 0.8 },
      { x: 0.5, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ]
  }

  function scorePixelContrast(base: [number, number, number, number], target: [number, number, number, number]) {
    return Math.abs(base[0] - target[0]) + Math.abs(base[1] - target[1]) + Math.abs(base[2] - target[2])
  }

  function scoreAnchorContrast(cellX: number, cellY: number, anchor: SampleAnchor) {
    const mappedPoint = mapPointToSource(cellX, cellY, anchor)
    const { startX, startY, endX, endY } = resolveCellBounds(cellX, cellY)
    const centerX = clamp(Math.round(mappedPoint.x), startX, endX)
    const centerY = clamp(Math.round(mappedPoint.y), startY, endY)
    const center = readPixel(centerX, centerY)
    const left = readPixel(clamp(centerX - 1, startX, endX), centerY)
    const right = readPixel(clamp(centerX + 1, startX, endX), centerY)
    const top = readPixel(centerX, clamp(centerY - 1, startY, endY))
    const bottom = readPixel(centerX, clamp(centerY + 1, startY, endY))
    return (
      scorePixelContrast(center, left) +
      scorePixelContrast(center, right) +
      scorePixelContrast(center, top) +
      scorePixelContrast(center, bottom) +
      scorePixelContrast(left, right) * 0.35 +
      scorePixelContrast(top, bottom) * 0.35
    )
  }

  function resolveAutoCellAnchor(cellX: number, cellY: number) {
    let bestAnchor = getAutoAnchorCandidates()[0]
    let bestScore = Number.NEGATIVE_INFINITY
    let bestMappedPoint = mapPointToSource(cellX, cellY, bestAnchor)

    for (const candidate of getAutoAnchorCandidates()) {
      const score = scoreAnchorContrast(cellX, cellY, candidate)
      if (score > bestScore) {
        bestScore = score
        bestAnchor = candidate
        bestMappedPoint = mapPointToSource(cellX, cellY, candidate)
      }
    }

    return {
      anchor: { ...bestAnchor },
      score: bestScore,
      sampleX: bestMappedPoint.x,
      sampleY: bestMappedPoint.y,
    } satisfies AutoCellResolution
  }

  function ensureAutoAnchorCache() {
    if (!autoCacheDirty && autoAnchorCache.length === outputHeight && (autoAnchorCache[0]?.length ?? 0) === outputWidth) {
      return
    }

    autoAnchorCache = createAutoResolutionGrid(outputWidth, outputHeight)
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        autoAnchorCache[y][x] = resolveAutoCellAnchor(x, y)
      }
    }
    autoCacheDirty = false
  }

  function applyAutoSamplingToAllCells(algorithm: AutoSamplingAlgorithmId) {
    if (!sourceImageData) {
      return
    }

    ensureGrid(outputWidth, outputHeight)
    if (algorithm === 'feature-anchor') {
      ensureAutoAnchorCache()
    }

    const nextConfigs = cloneCellConfigGrid(cellConfigs)
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const config = nextConfigs[y][x]
        config.manualColor = null

        if (algorithm === 'feature-anchor') {
          const resolution = autoAnchorCache[y]?.[x] ?? resolveAutoCellAnchor(x, y)
          config.algorithmId = 'anchor-point'
          config.anchor = { ...resolution.anchor }
          continue
        }

        if (algorithm === 'multi-point-default') {
          config.algorithmId = 'multi-point-average'
          config.samplePoints = createDefaultSamplePoints()
          continue
        }

        config.algorithmId = 'cell-average'
      }
    }

    replaceCellConfigs(nextConfigs)
  }

  function buildAnchorSampleInfo(
    cellX: number,
    cellY: number,
    anchor: SampleAnchor,
    algorithmId: SampleAlgorithmId,
    options?: {
      rgba?: [number, number, number, number]
      isManualColor?: boolean
      samplePoints?: SamplePoint[]
    },
  ): CellInfo {
    const mappedPoint = mapPointToSource(cellX, cellY, anchor)
    const rgba = options?.rgba ?? readPixel(mappedPoint.x, mappedPoint.y)
    const samplePoints = options?.samplePoints ?? [mappedPoint]
    return {
      color: rgbaToColor(rgba),
      hex: rgbaToHex(rgba),
      rgba,
      sampleX: mappedPoint.x,
      sampleY: mappedPoint.y,
      displaySampleX: mappedPoint.x,
      displaySampleY: mappedPoint.y,
      algorithmId,
      samplePoints,
      region: buildSampleRegionInfo(cellX, cellY, algorithmId, samplePoints),
      isManualColor: options?.isManualColor ?? false,
    }
  }

  function sampleAnchorPoint(cellX: number, cellY: number, config: CellSampleConfig): CellInfo {
    return buildAnchorSampleInfo(cellX, cellY, config.anchor, config.algorithmId)
  }

  function sampleMultiPointAverage(cellX: number, cellY: number, config: CellSampleConfig): CellInfo {
    const normalizedPoints = config.samplePoints.length ? config.samplePoints : createDefaultSamplePoints()
    const mappedPoints = normalizedPoints.map((point) => mapPointToSource(cellX, cellY, point))
    const rgba = averageRgba(mappedPoints.map((point) => readPixel(point.x, point.y)))
    const displaySampleX = mappedPoints.reduce((sum, point) => sum + point.x, 0) / mappedPoints.length
    const displaySampleY = mappedPoints.reduce((sum, point) => sum + point.y, 0) / mappedPoints.length
    return {
      color: rgbaToColor(rgba),
      hex: rgbaToHex(rgba),
      rgba,
      sampleX: displaySampleX,
      sampleY: displaySampleY,
      displaySampleX,
      displaySampleY,
      algorithmId: config.algorithmId,
      samplePoints: mappedPoints,
      region: buildSampleRegionInfo(cellX, cellY, config.algorithmId, mappedPoints),
      isManualColor: false,
    }
  }

  function sampleCellAverage(cellX: number, cellY: number, config: CellSampleConfig): CellInfo {
    const { startX, startY, endX, endY } = resolveCellBounds(cellX, cellY)
    const samples: [number, number, number, number][] = []
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        samples.push(readPixel(x, y))
      }
    }
    const rgba = averageRgba(samples)
    const displaySampleX = (startX + endX) / 2
    const displaySampleY = (startY + endY) / 2
    return {
      color: rgbaToColor(rgba),
      hex: rgbaToHex(rgba),
      rgba,
      sampleX: displaySampleX,
      sampleY: displaySampleY,
      displaySampleX,
      displaySampleY,
      algorithmId: config.algorithmId,
      samplePoints: [],
      region: buildSampleRegionInfo(cellX, cellY, config.algorithmId, []),
      isManualColor: false,
    }
  }

  function sampleCell(cellX: number, cellY: number): CellInfo | null {
    if (!sourceImageData || !cellConfigs[cellY]?.[cellX]) {
      return null
    }
    const config = cellConfigs[cellY][cellX]
    if (config.manualColor) {
      const rgba = hexToRgba(config.manualColor)
      if (rgba) {
        const region = buildSampleRegionInfo(cellX, cellY, config.algorithmId, [])
        const displaySampleX = (region.startX + region.endX) / 2
        const displaySampleY = (region.startY + region.endY) / 2
        return {
          color: rgbaToColor(rgba),
          hex: rgbaToHex(rgba),
          rgba,
          sampleX: displaySampleX,
          sampleY: displaySampleY,
          displaySampleX,
          displaySampleY,
          algorithmId: config.algorithmId,
          samplePoints: [],
          region,
          isManualColor: true,
        }
      }
    }
    if (config.algorithmId === 'multi-point-average') {
      return sampleMultiPointAverage(cellX, cellY, config)
    }
    if (config.algorithmId === 'cell-average') {
      return sampleCellAverage(cellX, cellY, config)
    }
    return sampleAnchorPoint(cellX, cellY, config)
  }

  function getSampleRegion(cell: SelectedCell) {
    if (!cell) {
      return null
    }
    return sampleCell(cell.x, cell.y)?.region ?? null
  }

  function render(width: number, height: number) {
    if (!sourceImageData) {
      throw new Error('尚未加载图片')
    }
    ensureGrid(width, height)
    resultCanvas.width = width
    resultCanvas.height = height
    const imageData = resultCtx.createImageData(width, height)
    renderedCellInfos = createRenderedCellInfoGrid(width, height)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const info = sampleCell(x, y)
        renderedCellInfos[y][x] = info
        if (!info) {
          continue
        }
        const target = (y * width + x) * 4
        imageData.data[target] = info.rgba[0]
        imageData.data[target + 1] = info.rgba[1]
        imageData.data[target + 2] = info.rgba[2]
        imageData.data[target + 3] = info.rgba[3]
      }
    }

    resultCtx.putImageData(imageData, 0, 0)
    return resultCanvas
  }

  return {
    applyAutoSamplingToAllCells,
    cloneCellConfigs: () => cloneCellConfigGrid(cellConfigs),
    ensureGrid,
    getAnchor,
    getCellAlgorithm,
    getCellConfig,
    getCellSamplePoints,
    getOutputSize: () => ({ width: outputWidth, height: outputHeight }),
    getRenderedCellInfos: () => cloneRenderedCellInfoGrid(renderedCellInfos),
    getSamplingArea: () => ({ ...samplingArea }),
    getResultCanvas: () => resultCanvas,
    getSampleRegion,
    getSourceCanvas: () => sourceCanvas,
    render,
    replaceCellConfigs,
    resetSamplingArea,
    resetAnchor,
    resetAnchors,
    resetAllCellConfigs,
    resetCellConfig,
    resetCellSamplePoints,
    resizeGrid,
    sampleCell,
    setAnchor,
    setCellAlgorithm,
    setCellManualColor,
    setCellSamplePoints,
    setImage,
    setSamplingArea,
  }
}
