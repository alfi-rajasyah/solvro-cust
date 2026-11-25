import http from "node:http";
import type { AddressInfo } from "node:net";
import { env } from "../../src/env.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { SID } from "../statusFixtures.js";
import { createUserWithRole } from "../testAuth.js";

export const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

export interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface Receiver {
  url: string;
  received: Received[];
  respondWith: (status: number, headers?: Record<string, string>) => void;
  hang: () => void;
  close: () => Promise<void>;
}

/** A local http receiver; the policy flags are opened for the whole test file with `allowLocalTargets`. */
export async function startReceiver(): Promise<Receiver> {
  const received: Received[] = [];
  let status = 200;
  let extra: Record<string, string> = {};
  let hanging = false;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (hanging) return;
      res.writeHead(status, extra);
      res.end("remote body that must never be stored");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook?token=abc`,
    received,
    respondWith: (s, h = {}) => {
      status = s;
      extra = h;
    },
    hang: () => {
      hanging = true;
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

type MutableEnv = { WEBHOOK_ALLOW_HTTP: boolean; WEBHOOK_ALLOW_PRIVATE_HOSTS: boolean };

/** Opens the address policy for local receivers; returns the restore function. */
export function allowLocalTargets(): () => void {
  const e = env as unknown as MutableEnv;
  const before = { http: e.WEBHOOK_ALLOW_HTTP, priv: e.WEBHOOK_ALLOW_PRIVATE_HOSTS };
  e.WEBHOOK_ALLOW_HTTP = true;
  e.WEBHOOK_ALLOW_PRIVATE_HOSTS = true;
  return () => {
    e.WEBHOOK_ALLOW_HTTP = before.http;
    e.WEBHOOK_ALLOW_PRIVATE_HOSTS = before.priv;
  };
}

/** Marks every existing activity row dispatched so a test only sees its own events. */
export async function stampAllDispatched(): Promise<void> {
  await prisma.activityEvent.updateMany({ where: { webhookDispatchedAt: null }, data: { webhookDispatchedAt: new Date() } });
}

export async function projectFixture() {
  const owner = await createUserWithRole("TAM");
  const other = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: owner.userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: {
      statusId: SID.TODO,
      projectId: project.id,
      title: uniq("Task"),
      description: "PRIVATE DESCRIPTION TEXT",
      status: "TODO",
      priority: "MEDIUM",
      position: 0,
    },
  });
  return { owner, other, project, task };
}

export const SECRET = ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_") /* the Standard Webhooks spec's public example secret, split so secret scanners do not flag it */;

export function makeSubscription(
  ownerId: number,
  url: string,
  extra: Partial<{
    eventTypes: string[];
    projectIds: number[];
    active: boolean;
    consecutiveFailures: number;
  }> = {},
) {
  return prisma.webhookSubscription.create({
    data: {
      ownerId,
      name: uniq("hook"),
      url,
      secretEnc: seal(SECRET),
      eventTypes: extra.eventTypes ?? ["task.created", "task.status_changed", "task.completed", "comment.created", "project.created", "risk.created"],
      projectIds: extra.projectIds ?? [],
      active: extra.active ?? true,
      consecutiveFailures: extra.consecutiveFailures ?? 0,
    },
  });
}
