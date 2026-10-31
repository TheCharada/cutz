export type StoredFile = {
  key: string;
  contentType: string;
  size: number;
};

export interface StorageProvider {
  put(key: string, content: Buffer, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
