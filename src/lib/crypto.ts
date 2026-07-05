/**
 * AES-256-GCM encryption helpers for Cloudflare credential storage.
 * Pure functions using node:crypto for authenticated encryption.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Result of encryption: ciphertext, IV, and authentication tag (all base64-encoded).
 */
export interface EncryptionResult {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Payload for decryption: ciphertext, IV, and authentication tag (all base64-encoded).
 */
export interface DecryptionPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The plaintext string to encrypt
 * @param keyHex - The encryption key as a 64-character hex string (32 bytes)
 * @returns Object with base64-encoded ciphertext, iv, and authTag
 * @throws Error if key length is invalid (must be 64 hex chars / 32 bytes)
 */
export function encryptSecret(plaintext: string, keyHex: string): EncryptionResult {
  // Validate key length: must be 64 hex characters (32 bytes)
  if (keyHex.length !== 64) {
    throw new Error(`Invalid key length: expected 64 hex characters (32 bytes), got ${keyHex.length}`);
  }

  // Convert hex key to buffer
  let key: Buffer;
  try {
    key = Buffer.from(keyHex, "hex");
  } catch {
    throw new Error("Invalid key: must be a valid hex string");
  }

  // Verify key is exactly 32 bytes
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  // Generate random 12-byte IV for each call
  const iv = randomBytes(12);

  // Create cipher
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  // Encrypt plaintext
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.from(ciphertext, "hex").toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 *
 * @param payload - Object containing base64-encoded ciphertext, iv, and authTag
 * @param keyHex - The encryption key as a 64-character hex string (32 bytes)
 * @returns The decrypted plaintext string
 * @throws Error if key length is invalid, authentication fails, or decryption fails
 */
export function decryptSecret(payload: DecryptionPayload, keyHex: string): string {
  // Validate key length: must be 64 hex characters (32 bytes)
  if (keyHex.length !== 64) {
    throw new Error(`Invalid key length: expected 64 hex characters (32 bytes), got ${keyHex.length}`);
  }

  // Convert hex key to buffer
  let key: Buffer;
  try {
    key = Buffer.from(keyHex, "hex");
  } catch {
    throw new Error("Invalid key: must be a valid hex string");
  }

  // Verify key is exactly 32 bytes
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  // Decode base64 components
  let iv: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;

  try {
    iv = Buffer.from(payload.iv, "base64");
    ciphertext = Buffer.from(payload.ciphertext, "base64");
    authTag = Buffer.from(payload.authTag, "base64");
  } catch {
    throw new Error("Invalid payload: ciphertext, iv, and authTag must be valid base64");
  }

  // Create decipher
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt ciphertext
  try {
    let plaintext = decipher.update(ciphertext, undefined, "utf8");
    plaintext += decipher.final("utf8");
    return plaintext;
  } catch {
    throw new Error("Decryption failed: authentication tag mismatch or corrupted data");
  }
}
