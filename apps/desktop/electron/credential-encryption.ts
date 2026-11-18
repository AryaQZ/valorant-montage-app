// Adapter pattern follows OpenAI's Sign in with ChatGPT DevKit Paste Perfect example.
// The adapter stays in Electron main and fails closed if OS credential protection is unavailable.
import type { CredentialEncryption } from '@siwc/local';
import type { SafeStorage } from 'electron';

type StorageAPI = Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString' | 'getSelectedStorageBackend'>;

export function createElectronCredentialEncryption(
  storage: StorageAPI,
  isReady: () => boolean,
  platform: NodeJS.Platform = process.platform,
): CredentialEncryption {
  const isAvailable = () => {
    if (!isReady() || !storage.isEncryptionAvailable()) return false;
    return platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend());
  };
  const requireAvailable = () => {
    if (!isAvailable()) throw new Error('OS credential encryption is unavailable.');
  };
  return {
    id: 'electron-safe-storage-v1',
    isAvailable,
    encrypt(plaintext) { requireAvailable(); return storage.encryptString(plaintext); },
    decrypt(ciphertext) { requireAvailable(); return storage.decryptString(Buffer.from(ciphertext)); },
  };
}
