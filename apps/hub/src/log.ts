import pino from "pino";
import { env, isProd } from "./env.js";

export const log = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  transport: isProd
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
  base: { service: "hub" },
});

export type Logger = typeof log;
export const artifactDir = env.ARTIFACT_DIR;
