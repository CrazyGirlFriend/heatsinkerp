const colors: Record<string, string> = {
  库房: '#526477',
  中转库: '#526477',
  轧制: '#008579',
  轧板: '#008579',
  退火: '#98601c',
  研磨: '#8c25b5',
  线切割: '#1975cb',
  雕刻: '#a34e79',
  电镀: '#247b7b',
  检验: '#a94c16',
  质检: '#a94c16',
  工艺: '#4c60b0',
}

export function scheduleTeamStyle(name: string) {
  const color = colors[name] || '#526477'
  return { '--team-color': color, '--team-tint': `${color}0d`, '--team-border': `${color}30` }
}
