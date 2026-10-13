import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import type { Profile } from "../shared/types";
import type { Database, UserRecord } from "./storage";
import { ApiError } from "./errors";
import {
  duoAccountForUser,
  duoCredentialVersion,
  type DuoAuthenticationOptions,
} from "./duo-auth";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 14;
export const COOKIE_NAME = "ielts_session";
export interface AuthenticatedRequest extends Request {
  learner?: UserRecord;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, salt, hashText] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hashText || "") || stored.split(":").length !== 3) return false;
  const expected = Buffer.from(hashText, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function cookieOptions(production: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}
export async function createSession(
  database: Database,
  response: Response,
  userId: string,
  production: boolean,
  options: DuoAuthenticationOptions = {},
): Promise<void> {
  let duoVersion: string | undefined;
  if (options.duo) {
    const user = await database.users.findOne({ _id: userId });
    const account = user && duoAccountForUser(options.duo, user);
    if (!account) throw new ApiError(401, "Tài khoản này không được phép đăng nhập.");
    duoVersion = duoCredentialVersion(options.duo, account);
  }
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await database.sessions.insertOne({
    _id: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
    ...(duoVersion ? { duoCredentialVersion: duoVersion } : {}),
  });
  response.cookie(COOKIE_NAME, token, cookieOptions(production));
}
export async function deleteSession(
  database: Database,
  request: Request,
  response: Response,
  production: boolean,
): Promise<void> {
  const token: unknown = request.cookies?.[COOKIE_NAME];
  if (typeof token === "string")
    await database.sessions.deleteOne({ _id: hashToken(token) });
  const { maxAge: _maxAge, ...options } = cookieOptions(production);
  response.clearCookie(COOKIE_NAME, options);
}
export function attachLearner(database: Database, options: DuoAuthenticationOptions = {}) {
  return async (
    request: AuthenticatedRequest,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: unknown = request.cookies?.[COOKIE_NAME];
      if (typeof token === "string" && token.length <= 200) {
        const session = await database.sessions.findOne({
          _id: hashToken(token),
          expiresAt: { $gt: new Date() },
        }, { timeoutMS: 5_000 });
        if (session) {
          const learner = await database.users.findOne({ _id: session.userId }, { timeoutMS: 5_000 });
          if (learner) {
            const account = options.duo && duoAccountForUser(options.duo, learner);
            const sessionVersion = (session as typeof session & { duoCredentialVersion?: string }).duoCredentialVersion;
            if (!options.duo || (account && sessionVersion === duoCredentialVersion(options.duo, account)))
              request.learner = learner;
          }
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function requireLearner(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction,
): void {
  if (!request.learner) {
    next(new ApiError(401, "Vui lòng đăng nhập để tiếp tục."));
    return;
  }
  next();
}
export function learnerOf(request: Request): UserRecord {
  const user = (request as AuthenticatedRequest).learner;
  if (!user) throw new ApiError(401, "Vui lòng đăng nhập để tiếp tục.");
  return user;
}
export function initialProfile(
  input: {
    name: string;
    email: string;
    targetBand: number;
    testType: Profile["testType"];
    examDate?: string | null;
    weeklyMinutes?: number;
    dailyMinutes?: number;
    selfAssessment?: {
      reading: number | null;
      listening: number | null;
      writing: number | null;
      speaking: number | null;
    };
  },
  id: string,
): Profile {
  return {
    id,
    name: input.name,
    email: input.email.toLowerCase(),
    demo: false,
    targetBand: input.targetBand,
    testType: input.testType,
    examDate: input.examDate || null,
    weeklyMinutes: input.weeklyMinutes ?? 300,
    dailyMinutes: input.dailyMinutes ?? 45,
    currentBand: null,
    cefr: null,
    createdAt: new Date().toISOString(),
    ...(input.selfAssessment ? { selfAssessment: input.selfAssessment } : {}),
  };
}
