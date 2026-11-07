export type UserRole = 'ADMIN' | 'TEAM'
export type EntityId = string | number
export type TeamKind = 'production' | 'warehouse' | 'engineering' | 'dispatch' | 'business'

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
  avatar_key?: string
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

export interface PasswordChangePayload {
  old_password: string
  new_password: string
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
  avatar_key?: string
  password: string
  role: UserRole
  team_id: EntityId | null
  active?: boolean
}

export interface UpdateAccountPayload {
  username?: string
  display_name?: string
  avatar_key?: string
  password?: string
  role?: UserRole
  team_id?: EntityId | null
  active?: boolean
}
