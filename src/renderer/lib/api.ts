import type { HydrationApi } from '../../shared/types';

declare global {
  interface Window {
    hydration: HydrationApi;
  }
}

export const api: HydrationApi = window.hydration;
