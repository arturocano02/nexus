import { create } from "zustand";
import type { Profile } from "@/lib/types";

interface UserStore {
  profile: Profile | null;
  isLoadingProfile: boolean;
  setProfile: (profile: Profile | null) => void;
  setLoadingProfile: (loading: boolean) => void;
  clearProfile: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  profile: null,
  isLoadingProfile: true,
  setProfile: (profile) => set({ profile, isLoadingProfile: false }),
  setLoadingProfile: (isLoadingProfile) => set({ isLoadingProfile }),
  clearProfile: () => set({ profile: null, isLoadingProfile: false }),
}));
