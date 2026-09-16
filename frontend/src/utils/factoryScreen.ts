/** Keep the selected composition's type scale, extending its canvas instead of stretching it. */
export function factoryScreenLayout(width: number, height: number) {
  if (width < 960 || height < 540 || width / height < 1.15) return { narrow: true, scale: 1, width, height, rail: 384, sceneScale: 1 }
  const scale = Math.min(width / 1672, height / 940)
  const boardWidth = width / scale, boardHeight = height / scale
  return { narrow: false, scale, width: boardWidth, height: boardHeight, rail: Math.min(520, boardWidth * 384 / 1672), sceneScale: boardHeight / 940 }
}

/** CSS zoom and device density both matter; bound each canvas's pixel area and edge. */
export function factoryCanvasRatio(width: number, height: number, scale: number, deviceRatio: number, pixelBudget: number) {
  const area = Math.max(1, width * height)
  return Math.max(0.25, Math.min(Math.max(1, scale * deviceRatio), 3, Math.sqrt(pixelBudget / area), 4096 / Math.max(1, width, height)))
}
