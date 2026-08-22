"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decrypt = exports.encrypt = void 0;
const CryptoJS = require("crypto-js");
// In a real application, this should be retrieved from environment variables (e.g., process.env).
const SECRET_KEY = process.env.ENCRYPTION_SECRET || 'fallback-secret-key';
const encrypt = (text) => {
    if (!text)
        return text;
    return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};
exports.encrypt = encrypt;
const decrypt = (cipherText) => {
    if (!cipherText)
        return cipherText;
    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8) || cipherText;
    }
    catch (e) {
        return cipherText;
    }
};
exports.decrypt = decrypt;
//# sourceMappingURL=encryption.js.map