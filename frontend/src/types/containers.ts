export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created';
  state: string;
  created: string;
  labels: Record<string, string>;
  networks: string[];
  ports: Array<{
    ip: string;
    privatePort: number;
    publicPort: number;
    type: string;
  }>;
  isInfra?: boolean;
}

export interface ContainerStats {
  id: string;
  name: string;
  cpu: number;
  memory: number;
  memoryLimit: number;
  networkIn: number;
  networkOut: number;
  blockIn: number;
  blockOut: number;
  pids: number;
  status: string;
}
