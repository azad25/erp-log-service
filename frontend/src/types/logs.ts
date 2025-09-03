export interface LogEntry {
  timestamp: string;
  level: string;
  container: string;
  message: string;
  raw: string;
  service?: string;
  [key: string]: any;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  labels: Record<string, string>;
}

export type LogFilter = {
  level: string;
  search: string;
  container: string;
};
