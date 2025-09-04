export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  labels: Record<string, string>;
  isInfra?: boolean;
  created?: string;
  ports?: string[];
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
