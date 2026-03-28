import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_SALT_BYTES = 16;

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(PASSWORD_HASH_SALT_BYTES).toString("hex");
  const derivedKey = (await scrypt(
    password,
    salt,
    PASSWORD_HASH_KEY_LENGTH,
  )) as Buffer;

  return `${PASSWORD_HASH_ALGORITHM}:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, hashHex] = storedHash.split(":");

  if (algorithm !== PASSWORD_HASH_ALGORITHM || !salt || !hashHex) {
    return false;
  }

  const expectedHash = Buffer.from(hashHex, "hex");
  const derivedKey = (await scrypt(password, salt, expectedHash.length)) as Buffer;

  if (derivedKey.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedHash);
}
