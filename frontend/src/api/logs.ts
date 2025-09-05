import axios from 'axios';

const API_BASE_URL = '/api/v1/logs';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: number;
  labels: Record<string, string>;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  container: string;
  stream: string;
  level: string;
  raw: string;
}

export async function getContainers(): Promise<ContainerInfo[]> {
  try {
    const response = await axios.get(`${API_BASE_URL}/containers`);
    return response.data.map((container: any) => ({
      id: container.Id,
      name: container.Names?.[0]?.replace(/^\//, '') || container.Id,
      image: container.Image,
      status: container.Status,
      state: container.State,
      created: container.Created,
      labels: container.Labels || {}
    }));
  } catch (error) {
    console.error('Error fetching containers:', error);
    throw error;
  }
}

export async function getLogs(containerId: string, limit: number = 100): Promise<LogEntry[]> {
  try {
    const response = await axios.get(`${API_BASE_URL}/containers/${containerId}/logs`, {
      params: { limit }
    });
    return response.data.map((log: any) => ({
      timestamp: log.timestamp,
      message: log.message,
      container: log.container_id,
      stream: log.stream || 'stdout',
      level: log.level || 'info',
      raw: JSON.stringify(log)
    }));
  } catch (error) {
    console.error(`Error fetching logs for container ${containerId}:`, error);
    throw error;
  }
}
