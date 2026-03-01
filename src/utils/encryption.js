/**
 * AES-256-GCM Encryption Utility
 * Used for encrypting API keys at rest in the database.
 *
 * Requires ENCRYPTION_KEY env var (32-byte hex string = 64 hex chars).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }
  if (key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns { encrypted, iv, authTag } all as hex strings.
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag,
  };
}

/**
 * Decrypt an AES-256-GCM encrypted string back to plaintext.
 * Expects hex-encoded encrypted, iv, and authTag.
 */
function decrypt(encrypted, iv, authTag) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Mask an API key for display purposes.
 * Shows first 7 and last 4 characters, masks the rest.
 * e.g., "sk-ant-***...***key123"
 */
function maskApiKey(key) {
  if (key.length <= 11) {
    return "***" + key.slice(-4);
  }
  return key.slice(0, 7) + "***" + key.slice(-4);
}

module.exports = { encrypt, decrypt, maskApiKey };
