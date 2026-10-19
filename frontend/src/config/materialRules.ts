// Kilograms, cumulative for the same source in the same team. Reminder only.
export const materialWeightToleranceKg = 1
export const splittingTeamCodes = ['FACTORY-ROLL', 'FACTORY-WIRE', 'FACTORY-ENGRAVE'] as const
export const processingTeamCodes = [
  ...splittingTeamCodes,
  'FACTORY-ANNEAL',
  'FACTORY-GRIND',
  'FACTORY-PLATE',
  'FACTORY-QC',
] as const
export const isSplittingTeamCode = (code?: string) =>
  splittingTeamCodes.some((value) => value === code)
export const isProcessingTeamCode = (code?: string) =>
  processingTeamCodes.some((value) => value === code)
