
import { FormData } from './types';

const DB_NAME = 'MukhLipiDB';
const DB_VERSION = 1;
const DRAFT_KEY = 'current_draft';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * A robust wrapper for IndexedDB to simulate a real backend/database environment
 */
class DatabaseService {
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('submissions')) {
          db.createObjectStore('submissions', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getDraft(): Promise<FormData | null> {
    const data = localStorage.getItem(DRAFT_KEY);
    return data ? JSON.parse(data) : null;
  }

  async saveDraft(data: FormData): Promise<void> {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }

  async submitForm(data: FormData): Promise<void> {
    await delay(800); // Simulate network latency to a backend
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['submissions'], 'readwrite');
      const store = transaction.objectStore('submissions');
      const entry = {
        ...data,
        submittedAt: new Date().toISOString()
      };
      const request = store.add(entry);
      request.onsuccess = () => {
        localStorage.removeItem(DRAFT_KEY);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSubmissions(): Promise<any[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['submissions'], 'readonly');
      const store = transaction.objectStore('submissions');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearDatabase(): Promise<void> {
    localStorage.removeItem(DRAFT_KEY);
    const db = await this.getDB();
    const transaction = db.transaction(['submissions'], 'readwrite');
    const store = transaction.objectStore('submissions');
    store.clear();
  }
}

export const api = new DatabaseService();
