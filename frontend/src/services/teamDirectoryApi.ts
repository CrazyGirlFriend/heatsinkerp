import { normalizeTeam, type Team } from './adminApi'
import { httpRequest, HttpRequestError } from './httpClient'

export class TeamDirectoryApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); this.name = 'TeamDirectoryApiError' }
}

export const teamDirectoryApi = {
  async listTeamDirectory(): Promise<Team[]> {
    let result: Team[] | { items: Team[] }
    try {
      result = await httpRequest<Team[] | { items: Team[] }>('/team-directory', { noCache: true })
    } catch (error) {
      const failure = error instanceof HttpRequestError ? error : new HttpRequestError('无法连接服务器，请检查网络后重试')
      const body = failure.body && typeof failure.body === 'object' ? failure.body as { detail?: unknown } : null
      throw new TeamDirectoryApiError(typeof body?.detail === 'string' ? body.detail : failure.status === 401 ? '登录已过期，请重新登录' : failure.status ? `请求失败（${failure.status}）` : '无法连接服务器，请检查网络后重试', failure.status)
    }
    const items = Array.isArray(result) ? result : result?.items
    if (!Array.isArray(items)) throw new TeamDirectoryApiError('班组目录数据格式无效，请重试')
    return items.map(normalizeTeam).filter(team => team.active)
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || String(left.id).localeCompare(String(right.id), undefined, { numeric: true }))
  },
}
