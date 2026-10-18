import { PrismaClient } from "@prisma/client";
import { config } from "@ats/config";

// One PrismaClient per process. It owns a connection pool internally.
// (Pool size can be tuned with ?connection_limit=N on DATABASE_URL.)
export const prisma = new PrismaClient({
  datasourceUrl: config.DATABASE_URL,
  log: ["warn", "error"],
});

export async function checkDatabase(timeoutMs = 2000): Promise<boolean> {
  // Prisma's own connect timeout is longer than a health check should wait,
  // so we race the query against a short timer.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("postgres check timed out")), timeoutMs);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}