/**
 * Tests for src/lib/crypto.ts
 */

import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";

describe("crypto", () => {
  // Valid 64-character hex key (32 bytes)
  const validKey =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  describe("encryptSecret", () => {
    it("should encrypt plaintext and return object with ciphertext, iv, authTag", () => {
      const plaintext = "my-secret-password";
      const result = encryptSecret(plaintext, validKey);

      expect(result).toHaveProperty("ciphertext");
      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("authTag");
      expect(typeof result.ciphertext).toBe("string");
      expect(typeof result.iv).toBe("string");
      expect(typeof result.authTag).toBe("string");
    });

    it("should produce base64-encoded output", () => {
      const plaintext = "test";
      const result = encryptSecret(plaintext, validKey);

      // Base64 validation: should not throw
      expect(() => Buffer.from(result.ciphertext, "base64")).not.toThrow();
      expect(() => Buffer.from(result.iv, "base64")).not.toThrow();
      expect(() => Buffer.from(result.authTag, "base64")).not.toThrow();
    });

    it("should generate unique IVs for each call", () => {
      const plaintext = "same-plaintext";
      const result1 = encryptSecret(plaintext, validKey);
      const result2 = encryptSecret(plaintext, validKey);

      // IVs should be different
      expect(result1.iv).not.toBe(result2.iv);
      // But ciphertexts will differ due to different IVs
      expect(result1.ciphertext).not.toBe(result2.ciphertext);
    });

    it("should produce different ciphertexts for different plaintexts", () => {
      const result1 = encryptSecret("plaintext1", validKey);
      const result2 = encryptSecret("plaintext2", validKey);

      expect(result1.ciphertext).not.toBe(result2.ciphertext);
    });

    it("should throw on invalid key length (too short)", () => {
      const plaintext = "test";
      const shortKey = "0123456789abcdef"; // Only 16 hex chars

      expect(() => encryptSecret(plaintext, shortKey)).toThrow(
        /Invalid key length/
      );
    });

    it("should throw on invalid key length (too long)", () => {
      const plaintext = "test";
      const longKey =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" +
        "0123456789abcdef";

      expect(() => encryptSecret(plaintext, longKey)).toThrow(
        /Invalid key length/
      );
    });

    it("should throw on non-hex key", () => {
      const plaintext = "test";
      const invalidKey = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

      expect(() => encryptSecret(plaintext, invalidKey)).toThrow();
    });

    it("should handle empty plaintext", () => {
      const result = encryptSecret("", validKey);
      expect(result.ciphertext).toBeDefined();
      expect(result.iv).toBeDefined();
      expect(result.authTag).toBeDefined();
    });

    it("should handle long plaintext", () => {
      const plaintext = "a".repeat(10000);
      const result = encryptSecret(plaintext, validKey);

      expect(result.ciphertext).toBeDefined();
      expect(result.iv).toBeDefined();
      expect(result.authTag).toBeDefined();
    });

    it("should handle special characters and unicode", () => {
      const plaintext =
        "Secret with emoji: 🔐 and special chars: !@#$%^&*()\n\ttabs";
      const result = encryptSecret(plaintext, validKey);

      expect(result.ciphertext).toBeDefined();
      expect(result.iv).toBeDefined();
      expect(result.authTag).toBeDefined();
    });
  });

  describe("decryptSecret", () => {
    it("should decrypt encrypted message", () => {
      const plaintext = "my-secret-password";
      const encrypted = encryptSecret(plaintext, validKey);
      const decrypted = decryptSecret(encrypted, validKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should decrypt with correct key", () => {
      const plaintext = "secret-message";
      const encrypted = encryptSecret(plaintext, validKey);
      const decrypted = decryptSecret(encrypted, validKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw on wrong key", () => {
      const plaintext = "secret";
      const encrypted = encryptSecret(plaintext, validKey);

      const wrongKey =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      expect(() => decryptSecret(encrypted, wrongKey)).toThrow(
        /Decryption failed|authentication|mismatch/i
      );
    });

    it("should throw on tampered ciphertext", () => {
      const plaintext = "secret";
      const encrypted = encryptSecret(plaintext, validKey);

      // Tamper with ciphertext
      const tampered = {
        ciphertext: Buffer.from(
          Buffer.from(encrypted.ciphertext, "base64").toString("hex")
            .slice(0, -2) + "FF",
          "hex"
        ).toString("base64"),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      };

      expect(() => decryptSecret(tampered, validKey)).toThrow(
        /Decryption failed|authentication|mismatch/i
      );
    });

    it("should throw on tampered authTag", () => {
      const plaintext = "secret";
      const encrypted = encryptSecret(plaintext, validKey);

      // Tamper with authTag
      const tampered = {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: Buffer.from(
          Buffer.from(encrypted.authTag, "base64").toString("hex")
            .slice(0, -2) + "FF",
          "hex"
        ).toString("base64"),
      };

      expect(() => decryptSecret(tampered, validKey)).toThrow(
        /Decryption failed|authentication|mismatch/i
      );
    });

    it("should throw on invalid key length", () => {
      const plaintext = "secret";
      const encrypted = encryptSecret(plaintext, validKey);

      const shortKey = "0123456789abcdef";

      expect(() => decryptSecret(encrypted, shortKey)).toThrow(
        /Invalid key length/
      );
    });

    it("should throw on invalid base64 in payload", () => {
      const payload = {
        ciphertext: "not-valid-base64!!!",
        iv: "also-invalid!!!",
        authTag: "invalid-too!!!",
      };

      expect(() => decryptSecret(payload, validKey)).toThrow();
    });

    it("should roundtrip empty plaintext", () => {
      const plaintext = "";
      const encrypted = encryptSecret(plaintext, validKey);
      const decrypted = decryptSecret(encrypted, validKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should roundtrip long plaintext", () => {
      const plaintext = "a".repeat(10000);
      const encrypted = encryptSecret(plaintext, validKey);
      const decrypted = decryptSecret(encrypted, validKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should roundtrip special characters and unicode", () => {
      const plaintext =
        "Secret with emoji: 🔐 and special chars: !@#$%^&*()\n\ttabs";
      const encrypted = encryptSecret(plaintext, validKey);
      const decrypted = decryptSecret(encrypted, validKey);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("roundtrip encryption", () => {
    it("should encrypt and decrypt the same message", () => {
      const testCases = [
        "simple-password",
        "very-long-secret-" + "a".repeat(1000),
        "special: !@#$%^&*()",
        "unicode: 🔐🔒🔑",
        "",
        "\n\t\r",
      ];

      for (const plaintext of testCases) {
        const encrypted = encryptSecret(plaintext, validKey);
        const decrypted = decryptSecret(encrypted, validKey);
        expect(decrypted).toBe(plaintext);
      }
    });

    it("should produce different ciphertexts for same plaintext (due to random IV)", () => {
      const plaintext = "same-message";
      const encrypted1 = encryptSecret(plaintext, validKey);
      const encrypted2 = encryptSecret(plaintext, validKey);

      // Ciphertexts differ due to different random IVs
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

      // But both decrypt to the same plaintext
      const decrypted1 = decryptSecret(encrypted1, validKey);
      const decrypted2 = decryptSecret(encrypted2, validKey);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });
  });
});
