import { HTTP_AUTH_SESSION_STORAGE_KEY, httpRequest, HttpRequestError, type HttpRequestOptions } from '@/services/httpClient'

export type UserRole = 'ADMIN' | 'TEAM'
export type EntityId = string | number
export type TeamKind = 'production' | 'scrap' | 'warehouse'

export interface Team {
  opening_stock_enabled?: boolean
  id: EntityId
  code: string
  name: string
  description?: string | null
  active: boolean
  sort_order?: number
  kind?: TeamKind
  account_count?: number
  created_at?: string
  updated_at?: string
}

export interface Account {
  id: EntityId
  username: string
  display_name: string
  role: UserRole
  team_id: EntityId | null
  team: Team | null
  active: boolean
  last_login_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface AuthSession {
  access_token: string
  token_type: string
  expires_at?: string
  user: Account
}

export interface LoginPayload {
  username: string
  password: string
}

export interface TeamListParams {
  query?: string
  active?: boolean
}

export interface AccountListParams {
  query?: string
  role?: UserRole
  team_id?: EntityId
  active?: boolean
}

export interface CreateTeamPayload {
  code: string
  name: string
  description?: string | null
  active?: boolean
  sort_order?: number
  kind?: TeamKind
}

export type UpdateTeamPayload = Partial<CreateTeamPayload>

export interface CreateAccountPayload {
  username: string
  display_name: string
  password: string
  role: UserRole
  team_id: EntityId | null
  active?: boolean
}

export interface UpdateAccountPayload {
  username?: string
  display_name?: string
  password?: string
  role?: UserRole
  team_id?: EntityId | null
  active?: boolean
}

type UnknownRecord = Record<string, unknown>

export const AUTH_SESSION_STORAGE_KEY = HTTP_AUTH_SESSION_STORAGE_KEY

export class AdminApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body?: unknown

  constructor(message: string, status = 0, code?: string, body?: unknown) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function stringValue(...values: unknown[]): string {
  const value = values.find((item) => typeof item === 'string' || typeof item === 'number')
  return value === undefined ? '' : String(value)
}

function optionalString(...values: unknown[]): string | undefined {
  const value = values.find((item) => typeof item === 'string' && item.length > 0)
  return typeof value === 'string' ? value : undefined
}

function booleanValue(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return !['false', '0', 'disabled', 'inactive'].includes(value.toLowerCase())
  return fallback
}

export function normalizeRole(value: unknown): UserRole {
  const normalized = String(value || '').trim().toUpperCase().replaceAll('-', '_')
  return ['ADMIN', 'ADMINISTRATOR', 'SUPER_ADMIN'].includes(normalized) ? 'ADMIN' : 'TEAM'
}

export function normalizeTeam(value: unknown): Team {
  const raw = objectValue(value)
  return {
    id: (raw.id as EntityId | undefined) ?? stringValue(raw.code, raw.team_code, raw.name),
    code: stringValue(raw.code, raw.team_code, raw.group_code),
    name: stringValue(raw.name, raw.team_name, raw.group_name),
    description: optionalString(raw.description, raw.remark, raw.notes) ?? null,
    opening_stock_enabled: raw.opening_stock_enabled === true,
    active: booleanValue(raw.active ?? raw.is_active ?? raw.enabled),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    kind: raw.kind === 'scrap' ? 'scrap' : raw.kind === 'warehouse' ? 'warehouse' : 'production',
    account_count:
      raw.account_count === undefined && raw.user_count === undefined
        ? undefined
        : Number(raw.account_count ?? raw.user_count ?? 0),
    created_at: optionalString(raw.created_at, raw.createdAt),
    updated_at: optionalString(raw.updated_at, raw.updatedAt),
  }
}

export function normalizeAccount(value: unknown): Account {
  const raw = objectValue(value)
  const rawTeam = raw.team ?? raw.group
  const role = normalizeRole(raw.role ?? raw.account_role ?? raw.user_type)
  const nestedTeam = rawTeam && typeof rawTeam === 'object' ? normalizeTeam(rawTeam) : null
  const rawTeamId = raw.team_id ?? raw.teamId ?? raw.group_id ?? nestedTeam?.id
  const flatTeamName = optionalString(raw.team_name, raw.group_name)
  const team = nestedTeam || (flatTeamName && rawTeamId !== undefined && rawTeamId !== null
    ? {
        id: rawTeamId as EntityId,
        code: stringValue(raw.team_code, raw.group_code),
        name: flatTeamName,
        active: true,
      }
    : null)
  return {
    id: (raw.id as EntityId | undefined) ?? stringValue(raw.username, raw.account),
    username: stringValue(raw.username, raw.account, raw.login_name),
    display_name: stringValue(raw.display_name, raw.displayName, raw.full_name, raw.name, raw.username),
    role,
    team_id: role === 'TEAM' && rawTeamId !== undefined && rawTeamId !== null ? (rawTeamId as EntityId) : null,
    team,
    active: booleanValue(raw.active ?? raw.is_active ?? raw.enabled),
    last_login_at: optionalString(raw.last_login_at, raw.lastLoginAt) ?? null,
    created_at: optionalString(raw.created_at, raw.createdAt),
    updated_at: optionalString(raw.updated_at, raw.updatedAt),
  }
}

function messageFromBody(body: unknown, fallback: string): { message: string; code?: string } {
  const raw = objectValue(body)
  const detail = raw.detail
  if (typeof detail === 'string') return { message: localizedMessage(detail), code: optionalString(raw.code) }
  if (Array.isArray(detail)) {
    const first = objectValue(detail[0])
    return {
      message: localizedMessage(optionalString(first.msg) || fallback),
      code: optionalString(raw.code),
    }
  }
  if (detail && typeof detail === 'object') {
    const detailRecord = objectValue(detail)
    return {
      message: localizedMessage(optionalString(detailRecord.message, detailRecord.detail) || fallback),
      code: optionalString(detailRecord.code, raw.code),
    }
  }
  return {
    message: localizedMessage(optionalString(raw.message, raw.error) || fallback),
    code: optionalString(raw.code),
  }
}

function localizedMessage(message: string): string {
  const normalized = message.toLowerCase()
  const translations: Array<[string, string]> = [
    ['invalid username or password', '账号或密码错误'],
    ['invalid or expired access token', '登录已过期，请重新登录'],
    ['administrator role required', '仅管理员可以执行此操作'],
    ['team code or name already exists', '班组编码或名称已存在'],
    ['team is in use and cannot be deleted', '该班组正在使用中，请改为停用'],
    ['username already exists', '登录账号已存在'],
    ['team users must have a team_id', '班组账号必须绑定一个班组'],
    ['team_id must reference an active team', '班组账号必须绑定有效班组'],
    ['cannot delete the currently signed-in account', '不能删除当前登录账号'],
  ]
  return translations.find(([source]) => normalized.includes(source))?.[1] || message
}

async function request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  try {
    return await httpRequest<T>(path, { noCache: true, ...options, skipAuthExpiry: path === '/auth/login' })
  } catch (error) {
    const failure = error instanceof HttpRequestError ? error : new HttpRequestError(error instanceof Error ? error.message : '无法连接服务器')
    const fallback = failure.status ? `请求失败（${failure.status}）` : failure.message || '无法连接服务器'
    const info = messageFromBody(failure.body, fallback)
    throw new AdminApiError(info.message, failure.status, info.code, failure.body)
  }
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}

function parseList(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const raw = objectValue(value)
  for (const key of ['items', ...keys]) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[]
  }
  return []
}

function validateTeamBinding(role: UserRole, teamId: EntityId | null | undefined): void {
  if (role === 'TEAM' && (teamId === null || teamId === undefined || teamId === '')) {
    throw new AdminApiError('班组账号必须绑定一个班组', 422, 'TEAM_REQUIRED')
  }
}

function normalizeSession(value: unknown): AuthSession {
  const raw = objectValue(value)
  const token = stringValue(raw.access_token, raw.accessToken, raw.token)
  const rawUser = raw.user ?? raw.account ?? raw.profile
  if (!token || !rawUser) throw new AdminApiError('登录响应缺少令牌或账号信息', 500, 'INVALID_AUTH_RESPONSE')
  let expiresAt = optionalString(raw.expires_at, raw.expiresAt)
  if (!expiresAt && typeof raw.expires_in === 'number') {
    expiresAt = new Date(Date.now() + raw.expires_in * 1000).toISOString()
  }
  return {
    access_token: token,
    token_type: optionalString(raw.token_type, raw.tokenType) || 'Bearer',
    expires_at: expiresAt,
    user: normalizeAccount(rawUser),
  }
}

export const adminApi = {
  async login(payload: LoginPayload): Promise<AuthSession> {
    return normalizeSession(await request<unknown>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }))
  },

  async currentUser(): Promise<Account> {
    const result = await request<unknown>('/auth/me')
    const raw = objectValue(result)
    return normalizeAccount(raw.user ?? raw.account ?? result)
  },

  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' })
  },

  async listTeams(params: TeamListParams = {}): Promise<Team[]> {
    const result = await request<unknown>(`/teams${queryString({ query: params.query, active: params.active })}`)
    return parseList(result, ['teams']).map(normalizeTeam)
  },

  async createTeam(payload: CreateTeamPayload): Promise<Team> {
    return normalizeTeam(await request('/teams', { method: 'POST', body: JSON.stringify(payload) }))
  },

  async updateTeam(id: EntityId, payload: UpdateTeamPayload): Promise<Team> {
    return normalizeTeam(await request(`/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }))
  },

  async deleteTeam(id: EntityId): Promise<void> {
    await request(`/teams/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async listAccounts(params: AccountListParams = {}): Promise<Account[]> {
    const result = await request<unknown>(`/accounts${queryString({ query: params.query, role: params.role, team_id: params.team_id, active: params.active })}`)
    return parseList(result, ['accounts', 'users']).map(normalizeAccount)
  },

  async createAccount(payload: CreateAccountPayload): Promise<Account> {
    validateTeamBinding(payload.role, payload.team_id)
    const normalized = { ...payload, team_id: payload.role === 'ADMIN' ? null : payload.team_id }
    return normalizeAccount(await request('/accounts', { method: 'POST', body: JSON.stringify(normalized) }))
  },

  async updateAccount(id: EntityId, payload: UpdateAccountPayload): Promise<Account> {
    if (payload.role) validateTeamBinding(payload.role, payload.team_id)
    const normalized = { ...payload, ...(payload.role === 'ADMIN' ? { team_id: null } : {}) }
    return normalizeAccount(await request(`/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(normalized) }))
  },

  async deleteAccount(id: EntityId): Promise<void> {
    await request(`/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
