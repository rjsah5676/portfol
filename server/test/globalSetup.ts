import type { TestProject } from "vitest/node";

/**
 * 테스트용 MongoDB 주소를 정함.
 * MONGODB_URI가 있으면(CI의 mongo 서비스 등) 그걸 쓰고, 없으면 내장 MongoDB를 띄움.
 */
export default async function setup(project: TestProject) {
  let uri = process.env.MONGODB_URI ?? "";
  let stop: (() => Promise<unknown>) | null = null;
  if (!uri) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const server = await MongoMemoryServer.create();
    uri = server.getUri();
    stop = () => server.stop();
  }
  project.provide("mongoUri", uri);
  return async () => {
    await stop?.();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
