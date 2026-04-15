export type AuthProviderType = 'local' | 'google' | 'microsoft' | 'oidc' | 'okta' | 'auth0';

export interface AuthProvider {
  id: number;
  app_id: number;
  provider_name: string;
  provider_type: AuthProviderType;
  is_enabled: boolean;
  is_default: boolean;
}

export interface AuthProviderConfig {
  id: number;
  auth_provider_id: number;
  config_json: string;
}

export interface UserExternalIdentity {
  id: number;
  member_id: number;
  provider_id: number;
  external_subject: string;
  external_email: string | null;
}

export interface AuthGroupMapping {
  id: number;
  provider_id: number;
  provider_group_value: string;
  internal_group_id: number;
}

export interface AuthAuditLog {
  id: number;
  app_id: number;
  member_id: number | null;
  provider_id: number | null;
  event_type: string;
  event_data_json: string | null;
  created_at: string;
}

export interface AdminSession {
  isAdmin: boolean;
  loginAt?: number;
}

export interface MemberSession {
  memberId: number;
  appId: number;
  groupIds: number[];
}

export interface PendingMemberSession {
  memberId: number;
  appId: number;
  groupIds: number[];
  returnTo: string;
}

export interface PendingTotpSetup {
  memberId: number;
  appId: number;
  groupIds: number[];
  secret: string;
  returnTo: string;
}

declare module 'express-session' {
  interface SessionData {
    admin?: AdminSession;
    member?: MemberSession;
    pendingMember?: PendingMemberSession;
    pendingTotpSetup?: PendingTotpSetup;
    flash?: { type: string; message: string };
    currentAppId?: number;
    sqlCsrfToken?: string;
  }
}
