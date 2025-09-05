export interface LogEntry {
  timestamp: string;
  level: string;
  container: string;
  message: string;
  raw: string;
  service?: string;
  type?: 'log' | 'container_change' | 'close';
  containerId?: string;
  [key: string]: any;
}

export interface ContainerPort {
  container_port: string;
  host_ip?: string;
  host_port?: string;
  protocol?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  labels: Record<string, string>;
  isInfra?: boolean;
  created?: string;
  ports?: Array<string | ContainerPort>;
}

export type LogFilter = {
  level: string;
  search: string;
  container: string;
};
