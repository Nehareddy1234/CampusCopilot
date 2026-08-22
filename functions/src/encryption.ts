import * as CryptoJS from 'crypto-js';

// In a real application, this should be retrieved from environment variables (e.g., process.env).
const SECRET_KEY = process.env.ENCRYPTION_SECRET || 'fallback-secret-key';

export const encrypt = (text: string): string => {
  if (!text) return text;
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

export const decrypt = (cipherText: string): string => {
  if (!cipherText) return cipherText;
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || cipherText;
  } catch (e) {
    return cipherText;
  }
};
