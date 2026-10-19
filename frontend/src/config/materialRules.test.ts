import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { materialWeightToleranceKg, processingTeamCodes } from './materialRules'
import { teamCanProcess } from './teamWorkspaces'
const backendSource = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../backend/app/${file}`, import.meta.url)), 'utf8')
describe('material policy contract', () => {
  it('keeps browser weight reminders aligned with backend analytics', () => {
    const value = backendSource('material_weight.py').match(
      /MATERIAL_WEIGHT_TOLERANCE\s*=\s*Decimal\("([\d.]+)"\)/,
    )?.[1]
    expect(Number(value)).toBe(materialWeightToleranceKg)
  })
  it('uses the same processing teams for entries and server authorization', () => {
    const declaration = [
      ...backendSource('team_constants.py').matchAll(
        /(?:SPLITTING|PROCESSING)_TEAM_CODES\s*=\s*\(([^)]+)\)/g,
      ),
    ]
      .map((match) => match[1])
      .join(' ')
    const codes = [...declaration.matchAll(/"(FACTORY-[A-Z]+)"/g)].map((match) => match[1])
    expect([...processingTeamCodes].sort()).toEqual(codes.sort())
    for (const code of processingTeamCodes) {
      expect(teamCanProcess({ code, kind: 'production' })).toBe(true)
      expect(teamCanProcess({ code, kind: 'warehouse' })).toBe(false)
    }
    expect(teamCanProcess({ code: 'FACTORY-WAREHOUSE', kind: 'warehouse' })).toBe(false)
    expect(teamCanProcess()).toBe(false)
  })
})
