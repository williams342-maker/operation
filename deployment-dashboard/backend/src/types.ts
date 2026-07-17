export type AppSettings = {
  github: {
    repository: string;
    branch: string;
  };
  paths: {
    repoRoot: string;
    backendRoot: string;
    frontendRoot: string;
    backendEnv: string;
    frontendEnv: string;
    backupRoot: string;
    logRoot: string;
  };
  commands: {
    backendInstall: string[];
    frontendInstall: string[];
    frontendBuild: string[];
  };
  pm2: {
    backendProcess: string;
    frontendProcess: string;
  };
  envValidation: {
    backendRequired: string[];
    frontendRequired: string[];
  };
  auth: {
    issuer?: string;
    audience?: string;
  };
};

export type EnvEntry = {
  key: string;
  value: string;
  masked: boolean;
  required: boolean;
  present: boolean;
};

export type LogSource = "backend" | "frontend" | "deployment";
