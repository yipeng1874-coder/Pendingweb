import type { Identity, RoleCode } from "../../types";

export const ROLE_LEVEL: Record<RoleCode, number> = {
  DEV_ADMIN: 1,
  HQ_ADMIN: 2,
  BASE_ADMIN: 3,
  TEAM_ADMIN: 4,
  HALL_MANAGER: 5,
  ANCHOR: 6,
};

export function pickBestIdentity(identities: Identity[]): Identity | null {
  if (!identities.length) return null;
  return [...identities].sort((a, b) => {
    // 1. 等级高的优先
    const lvDiff = (ROLE_LEVEL[a.roleCode] ?? 99) - (ROLE_LEVEL[b.roleCode] ?? 99);
    if (lvDiff !== 0) return lvDiff;
    // 2. 最近切换的优先（null 排后面）
    const aSwitch = a.lastSwitchedAt ? new Date(a.lastSwitchedAt).getTime() : 0;
    const bSwitch = b.lastSwitchedAt ? new Date(b.lastSwitchedAt).getTime() : 0;
    if (bSwitch !== aSwitch) return bSwitch - aSwitch;
    // 3. 最早授权的优先
    const aGrant = a.grantedAt ? new Date(a.grantedAt).getTime() : 0;
    const bGrant = b.grantedAt ? new Date(b.grantedAt).getTime() : 0;
    if (aGrant !== bGrant) return aGrant - bGrant;
    // 4. id 兜底
    return a.id.localeCompare(b.id);
  })[0];
}

/** 有权限访问全局仪表台的角色 */
export const COCKPIT_ROLES: RoleCode[] = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"];
