export interface Member {
  id: number;
  app_id: number;
  email: string;
  username: string | null;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  is_active: boolean;
  tfa_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberPublic extends Omit<Member, 'password_hash' | 'tfa_secret'> {}

export interface MemberGroupAssignment {
  id: number;
  member_id: number;
  group_id: number;
}

export interface CreateMemberInput {
  app_id: number;
  email: string;
  username?: string | null;
  password: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
}

export interface UpdateMemberInput {
  email?: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  is_active?: boolean;
}
