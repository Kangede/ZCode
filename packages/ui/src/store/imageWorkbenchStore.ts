import { create } from "zustand";

interface ImageWorkbenchState {
  openScope: string | null;
  show(scope: string): void;
  hide(): void;
}

/** Presentation only. Accepted jobs and versions belong to the session runtime. */
export const useImageWorkbenchStore = create<ImageWorkbenchState>((set) => ({
  openScope: null,
  show: (scope) => set({ openScope: scope }),
  hide: () => set({ openScope: null }),
}));
