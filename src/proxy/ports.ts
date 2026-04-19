import { createConnection } from 'net';

export interface PortCheckResult {
  port: number;
  available: boolean;
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

export async function checkRequiredPorts(): Promise<PortCheckResult[]> {
  const ports = [80, 443];
  return Promise.all(
    ports.map(async (port) => ({
      port,
      available: await checkPort(port),
    })),
  );
}

export function getUnavailablePorts(results: PortCheckResult[]): number[] {
  return results.filter((r) => !r.available).map((r) => r.port);
}
