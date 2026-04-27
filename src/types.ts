export type SampleAnchor = {
  x: number
  y: number
}

export type SamplePoint = {
  x: number
  y: number
}

export type SamplingArea = {
  x: number
  y: number
  width: number
  height: number
}

export type SampleAlgorithmId = 'anchor-point' | 'multi-point-average' | 'cell-average'

export type CellSampleConfig = {
  algorithmId: SampleAlgorithmId
  anchor: SampleAnchor
  samplePoints: SamplePoint[]
  manualColor: string | null
}

export type SelectedCell = {
  x: number
  y: number
} | null

export type SourceImageState = {
  width: number
  height: number
  name: string
}

export type SampleRegionInfo = {
  startX: number
  startY: number
  endX: number
  endY: number
  samplePoints: SamplePoint[]
  algorithmId: SampleAlgorithmId
}

export type CellInfo = {
  color: string
  hex: string
  rgba: [number, number, number, number]
  sampleX: number
  sampleY: number
  displaySampleX: number
  displaySampleY: number
  algorithmId: SampleAlgorithmId
  samplePoints: SamplePoint[]
  region: SampleRegionInfo
  isManualColor: boolean
}

export type SamplerSnapshot = {
  cellConfigs: CellSampleConfig[][]
  samplingArea: SamplingArea
}
