import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/knex';
import type { Member, MemberPublic, CreateMemberInput, UpdateMemberInput } from '../domain/types';

const SALT_ROUNDS = 12;

function toPublic(member: Member): MemberPublic {
  const { password_hash, tfa_secret, ...pub } = member;
  return pub;
}

export async function listMembers(appId: number): Promise<MemberPublic[]> {
  const rows = await db('members').where({ app_id: appId }).orderBy('email');
  return rows.map(toPublic);
}

export async function getMember(id: number): Promise<MemberPublic | undefined> {
  const row = await db('members').where({ id }).first();
  return row ? toPublic(row) : undefined;
}

export async function getMemberByEmail(appId: number, email: string): Promise<Member | undefined> {
  return db('members').where({ app_id: appId, email }).first();
}

export async function createMember(input: CreateMemberInput): Promise<MemberPublic> {
  const password_hash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const [id] = await db('members').insert({
    app_id: input.app_id,
    email: input.email,
    username: input.username ?? null,
    password_hash,
    first_name: input.first_name ?? null,
    last_name: input.last_name ?? null,
    avatar_url: input.avatar_url ?? null,
    phone: input.phone ?? null,
    is_active: true
  });
  const row = await db('members').where({ id }).first();
  return toPublic(row);
}

export async function updateMember(id: number, input: UpdateMemberInput): Promise<MemberPublic | undefined> {
  await db('members').where({ id }).update(input);
  return getMember(id);
}

export async function setPassword(id: number, newPassword: string): Promise<void> {
  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db('members').where({ id }).update({ password_hash });
}

export async function verifyPassword(member: Member, password: string): Promise<boolean> {
  return bcrypt.compare(password, member.password_hash);
}

export async function deleteMember(id: number): Promise<void> {
  await db('members').where({ id }).delete();
}

export async function getMemberGroups(memberId: number): Promise<number[]> {
  const rows = await db('member_group_assignments').where({ member_id: memberId }).select('group_id');
  return rows.map((r: { group_id: number }) => r.group_id);
}

export async function assignMemberToGroup(memberId: number, groupId: number): Promise<void> {
  await db('member_group_assignments')
    .insert({ member_id: memberId, group_id: groupId })
    .onConflict(['member_id', 'group_id'])
    .ignore();
}

export async function removeMemberFromGroup(memberId: number, groupId: number): Promise<void> {
  await db('member_group_assignments').where({ member_id: memberId, group_id: groupId }).delete();
}

export async function setTfaSecret(memberId: number, secret: string): Promise<void> {
  await db('members').where({ id: memberId }).update({ tfa_secret: secret });
}

export async function getTfaSecret(memberId: number): Promise<string | null> {
  const row = await db('members').where({ id: memberId }).select('tfa_secret').first();
  return row?.tfa_secret ?? null;
}

export async function clearTfaSecret(memberId: number): Promise<void> {
  await db('members').where({ id: memberId }).update({ tfa_secret: null });
}

// ── Password reset tokens ────────────────────────────────────────────────────

const RESET_TOKEN_TTL_MINUTES = 60;

export async function createResetToken(memberId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  // Invalidate any existing unused tokens for this member
  await db('password_reset_tokens')
    .where({ member_id: memberId })
    .whereNull('used_at')
    .delete();
  await db('password_reset_tokens').insert({
    member_id: memberId,
    token,
    expires_at: expiresAt,
  });
  return token;
}

export async function consumeResetToken(token: string): Promise<number | null> {
  const row = await db('password_reset_tokens')
    .where({ token })
    .whereNull('used_at')
    .where('expires_at', '>', new Date())
    .first();
  if (!row) return null;
  await db('password_reset_tokens').where({ id: row.id }).update({ used_at: new Date() });
  return row.member_id as number;
}

export async function peekResetToken(token: string): Promise<number | null> {
  const row = await db('password_reset_tokens')
    .where({ token })
    .whereNull('used_at')
    .where('expires_at', '>', new Date())
    .first();
  return row ? (row.member_id as number) : null;
}
