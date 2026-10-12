// Kilograms, cumulative for the same source in the same team. Reminder only.
export const materialWeightToleranceKg = 1
export const processingTeamCodes = ['FACTORY-ROLL', 'FACTORY-WIRE', 'FACTORY-ENGRAVE'] as const
export const isProcessingTeamCode = (code?: string) =>
  processingTeamCodes.some((value) => value === code)
