import { StoredAppState, loadStoredState, saveStoredState } from "./localDeckStorage";

export type AppStorageRepository = {
  loadAppState: () => Promise<StoredAppState>;
  saveAppState: (state: StoredAppState) => Promise<void>;
};

export class LocalAppStorageRepository implements AppStorageRepository {
  async loadAppState(): Promise<StoredAppState> {
    return loadStoredState();
  }

  async saveAppState(state: StoredAppState): Promise<void> {
    saveStoredState(state);
  }
}

export const localAppStorageRepository = new LocalAppStorageRepository();
