import { describe, expect, it } from 'vitest'
import { factoryCanvasRatio, factoryScreenLayout } from './factoryScreen'

describe('factory screen layout', () => {
  it.each([[1366, 768], [1920, 1080], [2560, 1440], [1920, 1200], [1280, 1024]])('fills %i × %i without stretching the composition', (width, height) => {
    const layout = factoryScreenLayout(width, height)
    expect(layout.narrow).toBe(false)
    expect(layout.width * layout.scale).toBeCloseTo(width)
    expect(layout.height * layout.scale).toBeCloseTo(height)
    expect(layout.rail).toBeGreaterThanOrEqual(384)
    expect(layout.width - 2 * layout.rail - 114).toBeGreaterThan(780)
    // Robot action controls must remain above the current batch card.
    expect(674 * layout.sceneScale).toBeLessThan(layout.height - 258)
  })
  it.each([[390, 844], [844, 390], [768, 1024], [1080, 1920], [1400, 450], [0, 0]])('reflows %i × %i instead of shrinking text past usability', (width, height) => {
    expect(factoryScreenLayout(width, height)).toMatchObject({ narrow: true, scale: 1 })
  })
  it('preserves the selected reference layout at its native size', () => {
    expect(factoryScreenLayout(1672, 940)).toEqual({ narrow: false, scale: 1, width: 1672, height: 940, rail: 384, sceneScale: 1 })
  })
})

describe('bounded high resolution canvas', () => {
  it('increases robot resolution with display scaling, including Retina displays', () => {
    expect(factoryCanvasRatio(530, 540, 2560 / 1672, 1, 2_250_000)).toBeCloseTo(2560 / 1672)
    expect(factoryCanvasRatio(530, 540, 1, 2, 2_250_000)).toBe(2)
  })
  it.each([[530, 540, 4, 3, 2_250_000], [2260, 742, 3, 2, 4_000_000], [530, 810, 4, 2, 2_250_000]])('bounds GPU pixel area and edge length', (width, height, scale, dpr, budget) => {
    const ratio = factoryCanvasRatio(width, height, scale, dpr, budget)
    expect(width * height * ratio ** 2).toBeLessThanOrEqual(budget + 1)
    expect(Math.max(width, height) * ratio).toBeLessThanOrEqual(4096)
  })
})
