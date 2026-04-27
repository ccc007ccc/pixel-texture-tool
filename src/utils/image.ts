export async function fileToImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    return { image, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export function revokeImageUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url)
  }
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png') {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('导出图片失败'))
        return
      }
      resolve(blob)
    }, type)
  })
}

export async function copyCanvasImage(canvas: HTMLCanvasElement) {
  const blob = await canvasToBlob(canvas)
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持直接复制图片，请改用保存图片')
  }
  const item = new window.ClipboardItem({ 'image/png': blob })
  await navigator.clipboard.write([item])
}

export async function saveCanvasImage(canvas: HTMLCanvasElement, filename: string) {
  const blob = await canvasToBlob(canvas)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
