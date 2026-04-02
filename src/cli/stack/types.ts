export type SupportedServiceKind = 'app' | 'worker' | 'postgres' | 'redis' | 'nginx';

export interface ManagedStackService {
  kind: SupportedServiceKind;
  serviceName: string;
  deployable: boolean;
  port?: number;
  internalPort?: number;
  command?: string;
  healthcheckPath?: string;
  databaseName?: string;
  username?: string;
  passwordEnvKey?: string;
  appendOnly?: boolean;
  targetService?: string;
  targetPort?: number;
}

export interface ManagedStackMetadata {
  managed: true;
  version: 1;
  repository: string;
  environment: string;
  services: ManagedStackService[];
}

export interface ManagedComposeFile {
  services: Record<string, Record<string, unknown>>;
  volumes?: Record<string, Record<string, never>>;
  [key: string]: unknown;
}

export interface StackBuildArtifacts {
  composeFile: ManagedComposeFile;
  envBlocks: Array<{ blockId: string; entries: Record<string, string> }>;
  deployEnvEntries: Record<string, string>;
  extraFiles: Array<{ relativePath: string; content: string }>;
  deployableServices: string[];
}
