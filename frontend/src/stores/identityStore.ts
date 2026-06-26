import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity } from "../types";

interface IdentityState {
  currentIdentity?: Identity;
  permissions: string[];
  /** 每次切换身份时递增，用于触发各页面的数据刷新 */
  identityVersion: number;
  setIdentity: (identity: Identity) => void;
  setPermissions: (permissions: string[]) => void;
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set) => ({
      permissions: [],
      identityVersion: 0,
      setIdentity: (identity) => set((state) => ({ currentIdentity: identity, identityVersion: state.identityVersion + 1 })),
      setPermissions: (permissions) => set({ permissions }),
    }),
    {
      name: "identity", // localStorage key
      // permissions 不需要持久化（每次刷新从后端重新拉取）
      partialize: (state) => ({ currentIdentity: state.currentIdentity }),
    }
  )
);
